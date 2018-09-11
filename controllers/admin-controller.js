const express = require('express');
const jwt = require('express-jwt');
const _ = require('lodash');

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
    include: [
      {
        model: MiningReviewerReport,
      },
    ],
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
          console.log(app);
          const appAttrs = { appId: app.id, reviewerId: reviewer.id, reportId };
          const [appReview] = await MiningReviewerRanking.findOrBuild({
            where: appAttrs,
            defaults: appAttrs,
          });
          await appReview.update({
            ...appAttrs,
            ranking: appParams.Ranking,
          });
          resolve(appReview);
        } catch (error) {
          console.log(error);
          reject(error);
        }
      }),
  );
  const appModels = await Promise.all(saveAppReviews);
  console.log(appModels[0].dataValues);
  console.log(reviewer.dataValues);
  res.json({ success: true });
});

const updateableReportKeys = ['purchaseExchangeName', 'purchasedAt', 'purchaseConversionRate', 'BTCTransactionId'];

router.post('/monthly-reports/:id', async (req, res) => {
  const data = _.pick(req.body, updateableReportKeys);
  const report = await MiningMonthlyReport.findById(req.params.id);
  await report.update(data);
  res.json({ success: true });
});

module.exports = router;
