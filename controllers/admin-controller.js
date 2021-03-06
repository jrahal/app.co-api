const express = require('express');
const jwt = require('express-jwt');
const _ = require('lodash');
const { Op } = require('sequelize');
const papa = require('papaparse');

const { App, MiningMonthlyReport, MiningReviewerReport, MiningReviewerRanking } = require('../db/models');
const { clearCache } = require('../common/lib/utils');

const router = express.Router();

router.use(jwt({ secret: process.env.JWT_SECRET }));

const { admins } = require('../config/config.json');

router.use((req, res, next) => {
  if (!req.user) {
    return next(); // handled by express-jwt
  }
  if (admins.indexOf(req.user.data.username) === -1) {
    return res.status(400).json({ success: false });
  }
  return next();
});

const updatableKeys = [
  'name',
  'contact',
  'website',
  'description',
  'imageUrl',
  'category',
  'blockchain',
  'authentication',
  'storageNetwork',
  'openSourceUrl',
  'twitterHandle',
  'notes',
  'status',
  'isKYCVerified',
  'BTCAddress',
];

router.post('/apps/:appId', async (req, res) => {
  let app = await App.findOne({ ...App.includeOptions, where: { id: req.params.appId } });
  console.log(`Saving ${app.name}`);
  const data = _.pick(req.body, updatableKeys);
  console.log(data);

  app = await app.update(data);
  await clearCache();

  res.json({ success: true, app });
});

router.get('/apps/pending', async (req, res) => {
  const apps = await App.findAll({
    where: {
      status: 'pending_audit',
    },
  });
  // console.log(apps);
  res.json({ apps });
});

router.get('/apps', async (req, res) => {
  const apps = await App.findAllWithRankings(true);
  res.json({ apps });
});

router.get('/monthly-reports', async (req, res) => {
  const reports = await MiningMonthlyReport.findAll({
    include: MiningMonthlyReport.includeOptions,
  });
  reports.forEach((report) => {
    report.compositeRankings = report.getCompositeRankings();
  });
  res.json({ reports });
});

router.post('/monthly-reports/:id/upload', async (req, res) => {
  console.log(req.params);
  const reportId = req.params.id;
  console.log(req.body);
  const { reviewerName, summary, apps } = req.body;
  // const month = await MiningMonthlyReport.findById(reportId);
  const reviewerAttrs = {
    reportId,
    reviewerName,
  };
  const [reviewer] = await MiningReviewerReport.findOrCreate({
    where: reviewerAttrs,
    defaults: {
      ...reviewerAttrs,
      summary,
    },
  });
  await reviewer.update({ summary });
  const saveAppReviews = apps.map(
    (appParams) =>
      new Promise(async (resolve, reject) => {
        try {
          const app = await App.findById(appParams.appId);
          if (!app) {
            return reject(new Error(`Spreadsheet contains app ID "${appParams.appId}" that fails to match.`));
          }
          // console.log(app);
          const appAttrs = { appId: app.id, reviewerId: reviewer.id, reportId };
          const [appReview] = await MiningReviewerRanking.findOrBuild({
            where: appAttrs,
            defaults: appAttrs,
          });
          await appReview.update({
            ...appAttrs,
            standardScore: appParams['Final Standardized Score'],
          });
          resolve(appReview);
        } catch (error) {
          console.log(error);
          reject(error);
        }
      }),
  );
  try {
    await Promise.all(saveAppReviews);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

const updateableReportKeys = [
  'purchaseExchangeName',
  'purchasedAt',
  'purchaseConversionRate',
  'BTCTransactionId',
  'status',
  'name',
];

router.post('/monthly-reports/:id', async (req, res) => {
  const data = _.pick(req.body, updateableReportKeys);
  // console.log(data);
  const report = await MiningMonthlyReport.findById(req.params.id, { include: MiningMonthlyReport.includeOptions });
  await report.update(data);
  if (data.BTCTransactionId) {
    await report.savePaymentInfo(data.BTCTransactionId);
  }
  res.json({ success: true });
});

router.delete('/monthly-reports/:monthId/reviewers/:id', async (req, res) => {
  const reviewer = await MiningReviewerReport.findById(req.params.id);
  await reviewer.destroy();
  await clearCache();
  // console.log(reviewer);
  res.json({ success: true });
});

router.get('/mining-ready-apps', async (req, res) => {
  const apps = await App.findAll({
    where: {
      BTCAddress: {
        [Op.or]: {
          [Op.ne]: null,
          [Op.ne]: '',
        },
      },
      isKYCVerified: true,
    },
  });
  // console.log(apps[0].dataValues);
  const appRows = apps.map((app) => ({
    'App Id': app.id,
    Ranking: '',
    CompositeScore: '',
    'App Name': app.name,
    Website: app.website,
    Description: app.description,
    'Image Url': app.imgixImageUrl,
  }));
  const csv = papa.unparse(appRows);
  return res.status(200).send(csv);
});

router.get('/mining-reports/:monthId/download-rankings', async (req, res) => {
  const month = await MiningMonthlyReport.findById(req.params.monthId, { include: MiningMonthlyReport.includeOptions });
  const rankings = month.compositeRankings.map((app) => {
    const appData = {
      ...app,
      rankings: app.rankings.join(','),
    };
    return appData;
  });
  const csv = papa.unparse(rankings);
  return res.status(200).send(csv);
});

module.exports = router;
