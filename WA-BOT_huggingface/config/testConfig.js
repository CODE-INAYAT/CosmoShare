"use strict";

const ENABLE_TEST_NUMBERS_ONLY = true; // Set to true to enable testing with only allowed numbers, false to allow all numbers

// List of allowed mobile numbers in international format (digits only, e.g., '919876543210')
const ALLOWED_TEST_NUMBERS = [
  // '12025550199',
  "30670646706328",
  "231623324881019",
];

// Override includes to add diagnostic logs and normalize comparisons
ALLOWED_TEST_NUMBERS.includes = function (senderPhone) {
  const logger = require("../src/utils/logger");
  logger.info(`[Filter-Debug] Incoming senderPhone: "${senderPhone}"`);
  logger.info(
    `[Filter-Debug] Configured ALLOWED_TEST_NUMBERS: ${JSON.stringify(
      this.slice()
    )}`
  );

  const normalizedSender = (senderPhone || "").replace(/\D/g, "");
  for (const allowed of this) {
    const normalizedAllowed = (allowed || "").replace(/\D/g, "");
    if (normalizedSender === normalizedAllowed && normalizedSender !== "") {
      logger.info(
        `[Filter-Debug] Match found! Allowing message from: "${senderPhone}"`
      );
      return true;
    }
  }

  logger.warn(
    `[Filter-Debug] Match NOT found! Blocking message from: "${senderPhone}"`
  );
  return false;
};

module.exports = {
  ENABLE_TEST_NUMBERS_ONLY,
  ALLOWED_TEST_NUMBERS,
};
