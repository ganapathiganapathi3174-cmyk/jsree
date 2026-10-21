import axios from 'axios';

// Never allow a request to hang forever: the verification endpoints run OCR on
// the server and can take tens of seconds (or stall on a cold start), which
// previously left the UI stuck on its submitting state with no way out.
// Increased to 240s to accommodate: Render cold start (30-60s) + full OCR pipeline (50-100s) + network overhead.
export const REQUEST_TIMEOUT_MS = 240000;

export function isTimeoutError(err) {
  return err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || err?.code === 'ERR_CANCELED';
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  withCredentials: true,
  timeout: REQUEST_TIMEOUT_MS
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      const path = window.location.pathname;
      if (path.startsWith('/admin')) {
        window.location.href = '/admin/login';
      } else {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
