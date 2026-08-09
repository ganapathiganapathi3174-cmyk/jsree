import * as planService from '../services/planService.js';

export async function getPlans(req, res) {
  try {
    const plans = planService.getPlans();
    res.json({
      success: true,
      data: plans
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch plans',
      code: 'FETCH_FAILED'
    });
  }
}

export async function requestPlanChange(req, res) {
  try {
    const userId = req.user.id;
    const { requested_plan, reason } = req.body;
    const requestedPlan = requested_plan || req.body.requestedPlan;
    const currentPlan = req.user.current_plan;

    const request = await planService.requestPlanChange(userId, currentPlan, requestedPlan, reason);
    res.status(201).json({
      success: true,
      data: request
    });
  } catch (error) {
    const status = error.code === 'SAME_PLAN' || error.code === 'INVALID_PLAN' ? 400 :
                   error.code === 'PENDING_EXISTS' ? 409 : 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to request plan change',
      code: error.code || 'REQUEST_FAILED'
    });
  }
}

export async function getMyRequests(req, res) {
  try {
    const requests = await planService.getPlanChangeRequests(req.user.id);
    res.json({
      success: true,
      data: requests
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch requests',
      code: error.code || 'FETCH_FAILED'
    });
  }
}
