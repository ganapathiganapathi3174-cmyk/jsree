import { body, param, query, validationResult } from 'express-validator';
import { sanitizeInput } from '../utils/helpers.js';

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      code: 'VALIDATION_ERROR',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

export const validateRegistration = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),
  body('mobile')
    .trim()
    .notEmpty().withMessage('Mobile is required')
    .isLength({ min: 10, max: 15 }).withMessage('Invalid mobile number')
    .matches(/^[0-9+]+$/).withMessage('Mobile must contain only digits and +'),
  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('referralCode')
    .optional()
    .trim()
    .isLength({ min: 3, max: 20 }).withMessage('Invalid referral code'),
  body('plan')
    .notEmpty().withMessage('Plan is required')
    .isIn(['120', '500', '1000']).withMessage('Plan must be 120, 500, or 1000'),
  handleValidationErrors
];

export const validateLogin = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required'),
  handleValidationErrors
];

export const validatePayment = [
  body('plan')
    .notEmpty().withMessage('Plan is required')
    .isIn(['120', '500', '1000']).withMessage('Plan must be 120, 500, or 1000'),
  handleValidationErrors
];

export const validateTopup = [
  body('topupId')
    .notEmpty().withMessage('Topup ID is required')
    .isUUID().withMessage('Invalid topup ID'),
  handleValidationErrors
];

export const validatePlanChange = [
  body('requestedPlan')
    .notEmpty().withMessage('Requested plan is required')
    .isIn(['120', '500', '1000']).withMessage('Plan must be 120, 500, or 1000'),
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Reason must be under 500 characters'),
  handleValidationErrors
];

export const validateChatMessage = [
  body('message')
    .trim()
    .notEmpty().withMessage('Message is required')
    .isLength({ max: 2000 }).withMessage('Message must be under 2000 characters'),
  handleValidationErrors
];

export const sanitize = (req, res, next) => {
  if (req.body) {
    for (const key of Object.keys(req.body)) {
      if (typeof req.body[key] === 'string') {
        req.body[key] = sanitizeInput(req.body[key]);
      }
    }
  }
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      if (typeof req.query[key] === 'string') {
        req.query[key] = sanitizeInput(req.query[key]);
      }
    }
  }
  next();
};
