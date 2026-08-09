# jsree

ReferralHub - Referral + Top-up Membership Platform

A production-ready referral and top-up membership platform built with React, Node.js, Express, and Supabase PostgreSQL.

## Features

- **User Registration** with payment verification (OCR-based screenshot analysis)
- **Referral System** - users earn through referrals with automatic status management
- **Top-up System** - referred users pay their referrers with proof submission
- **Plan Management** - users can request plan changes (admin approval required)
- **Real-time Chat** - user-admin communication
- **Admin Dashboard** - full management of users, payments, top-ups, plan changes, and audit logs
- **Audit Logging** - all important actions are tracked

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, React Router v6 |
| Backend | Node.js, Express.js, ES Modules |
| Database | Supabase PostgreSQL |
| Auth | JWT (bcryptjs password hashing) |
| File Storage | Supabase Storage |
| OCR | Tesseract.js |

## Project Structure

```
referral-platform/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page components
│   │   │   ├── user/       # User dashboard pages
│   │   │   └── admin/      # Admin dashboard pages
│   │   ├── services/       # API service layer
│   │   ├── utils/          # Helpers, constants, API config
│   │   └── styles/         # Global styles
│   └── package.json
├── server/                 # Express backend
│   ├── src/
│   │   ├── controllers/    # Request handlers
│   │   ├── services/       # Business logic
│   │   ├── routes/         # API routes
│   │   ├── middleware/     # Auth, validation, upload
│   │   ├── db/             # Supabase client
│   │   └── utils/          # Helpers
│   └── package.json
├── supabase/
│   └── migrations/         # Database schema SQL
├── .env.example
├── .gitignore
└── README.md
```

## Local Setup

### Prerequisites
- Node.js 18+
- npm or yarn
- Supabase project

### 1. Clone & Install

```bash
git clone <repo-url>
cd referral-platform

# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env` in the `server/` directory:

```bash
cp .env.example server/.env
```

Fill in your Supabase credentials:

```
DATABASE_URL=postgresql://...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
JWT_SECRET=your-min-32-char-secret
ADMIN_EMAIL=admin@gmail.com
ADMIN_PASSWORD=your-secure-password
ADMIN_UPI_ID=jayarajj126-3@okicici
CLIENT_URL=http://localhost:5173
```

### 3. Database Setup

Run the SQL migration in Supabase SQL Editor:

```bash
# Copy the contents of supabase/migrations/001_initial_schema.sql
# and run it in Supabase Dashboard > SQL Editor
```

### 4. Storage Setup

In Supabase Dashboard:
1. Go to **Storage**
2. Create a bucket named `payments`
3. Set it to **private** (not public)
4. Add policy: Allow authenticated users to upload
5. Add policy: Allow service role to read

### 5. Run Development

```bash
# Terminal 1 - Backend
cd server
npm run dev

# Terminal 2 - Frontend
cd client
npm run dev
```

Frontend: http://localhost:5173
Backend API: http://localhost:5000/api

## API Routes

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/register | Register new user |
| POST | /api/auth/login | User login |
| POST | /api/auth/admin-login | Admin login |
| GET | /api/auth/profile | Get profile |
| PUT | /api/auth/change-password | Change password |

### User
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/users/profile | Get profile |
| GET | /api/users/dashboard | Dashboard data |

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/payments | Create payment |
| POST | /api/payments/:id/screenshot | Upload screenshot |
| GET | /api/payments | List payments |
| GET | /api/payments/:id/status | Payment status |

### Referrals
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/referrals/my-code | Get referral code |
| GET | /api/referrals/my-referrals | List referrals |
| GET | /api/referrals/validate/:code | Validate code |

### Top-ups
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/topups | List top-ups |
| GET | /api/topups/:id | Top-up details |
| POST | /api/topups/:id/proof | Submit proof |

### Plans
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/plans | List plans |
| POST | /api/plans/change-request | Request plan change |
| GET | /api/plans/my-requests | My requests |

### Chat
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/chat/conversations | List conversations |
| GET | /api/chat/messages/:id | Get messages |
| POST | /api/chat/messages | Send message |

### Admin (all require admin auth)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/admin/dashboard | Dashboard stats |
| GET | /api/admin/users | List users |
| PUT | /api/admin/users/:id/status | Update user status |
| DELETE | /api/admin/users/:id | Delete user |
| GET | /api/admin/payments | List payments |
| PUT | /api/admin/payments/:id/approve | Approve payment |
| PUT | /api/admin/payments/:id/reject | Reject payment |
| GET | /api/admin/topups | List top-ups |
| DELETE | /api/admin/topups/:id | Delete top-up |
| GET | /api/admin/inactive-users | Inactive users |
| GET | /api/admin/plan-change-requests | Plan changes |
| PUT | /api/admin/plan-change-requests/:id/approve | Approve |
| PUT | /api/admin/plan-change-requests/:id/reject | Reject |
| GET | /api/admin/audit-logs | Audit logs |

## Deployment

### Vercel (Frontend)
1. Push to GitHub
2. Import project in Vercel
3. Set root directory to `client`
4. Build command: `npm run build`
5. Output: `dist`
6. Add env var: `VITE_API_URL` (your backend URL + /api)

### Backend
Deploy to Vercel as serverless functions or to a VPS (Railway, Render, etc.)

### Database
Use Supabase cloud (free tier available)

## Build Commands

```bash
# Frontend
cd client && npm run build

# Backend (no build needed for Node.js)
cd server && npm start
```

## License

MIT

