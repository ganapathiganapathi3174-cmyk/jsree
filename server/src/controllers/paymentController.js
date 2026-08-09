import * as paymentService from '../services/paymentService.js';
import fs from 'fs';
import path from 'path';

export async function createPayment(req, res) {
  try {
    const { plan } = req.body;
    const payment = await paymentService.createPayment(req.user.id, { plan });
    res.status(201).json({
      success: true,
      data: payment
    });
  } catch (error) {
    const status = error.code === 'INVALID_PLAN' ? 400 :
                   error.code === 'PENDING_EXISTS' || error.code === 'PAYMENT_EXISTS' ? 409 : 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to create payment',
      code: error.code || 'PAYMENT_CREATE_FAILED'
    });
  }
}

export async function uploadScreenshot(req, res) {
  try {
    const { paymentId } = req.params;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Screenshot file is required',
        code: 'NO_FILE'
      });
    }

    const result = await paymentService.uploadScreenshot(paymentId, req.file, req.user.id);

    let verificationResult = null;
    try {
      verificationResult = await paymentService.verifyPayment(paymentId, req.file.buffer);
    } catch (verifyErr) {
      verificationResult = { error: verifyErr.message, code: verifyErr.code };
    }

    res.json({
      success: true,
      data: {
        ...result,
        verification: verificationResult
      }
    });
  } catch (error) {
    const status = error.code === 'PAYMENT_NOT_FOUND' ? 404 :
                   error.code === 'PAYMENT_NOT_PENDING' ? 400 :
                   error.code === 'UNAUTHORIZED' ? 403 : 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to upload screenshot',
      code: error.code || 'UPLOAD_FAILED'
    });
  }
}

export async function getPaymentStatus(req, res) {
  try {
    const { paymentId } = req.params;
    const payment = await paymentService.getPaymentStatus(paymentId);
    res.json({
      success: true,
      data: payment
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message || 'Payment not found',
      code: error.code || 'PAYMENT_NOT_FOUND'
    });
  }
}

export async function getUserPayments(req, res) {
  try {
    const payments = await paymentService.getUserPayments(req.user.id);
    res.json({
      success: true,
      data: payments
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch payments',
      code: error.code || 'FETCH_FAILED'
    });
  }
}

export async function verifyPaymentManual(req, res) {
  try {
    const { paymentId } = req.params;
    const verificationResult = await paymentService.verifyPayment(paymentId);
    res.json({
      success: true,
      data: verificationResult
    });
  } catch (error) {
    const status = error.code === 'PAYMENT_NOT_FOUND' ? 404 :
                   error.code === 'PAYMENT_NOT_PENDING' ? 400 :
                   error.code === 'OCR_FAILED' || error.code === 'OCR_UNREADABLE' ? 422 : 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Verification failed',
      code: error.code || 'VERIFY_FAILED'
    });
  }
}
