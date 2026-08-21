# Aoun Backend

Backend service for **Aoun**, an experimental full-stack donation platform built to demonstrate secure, organized donation workflows between donors and recipients.

Aoun is a personal technical project. It is not presented as a production service with real users.

## Overview

The backend is built with Node.js and Express.js. It provides REST APIs, real-time events through Socket.IO, authentication and authorization workflows, donation management, safe-hub coordination, notifications, reporting, and administrative tools.

The codebase follows a layered architecture to separate request handling, business rules, data access, validation, and shared utilities.

## Tech Stack

- Node.js
- Express.js
- MongoDB and Mongoose
- Socket.IO
- JWT authentication
- Cookie-based request handling
- Helmet, CORS, and rate limiting
- Cloudinary and other external integrations where configured

## Main Features

- User registration, login, account verification, password reset, and phone authentication flows
- JWT-based authentication and role-based authorization
- Donation item and donation-request management
- Safe Hub management for direct public handovers
- Double-confirmation handover workflow between donor and recipient
- Real-time conversations, notifications, and application events using Socket.IO
- Ratings, leaderboards, reports, moderation, and admin settings
- Validation and authorization for state-changing requests

## Architecture

.
├── app.js
├── server.js
├── config/
├── controllers/
├── dtos/
├── integrations/
├── jobs/
├── middlewares/
├── models/
├── repositories/
├── routes/
├── scripts/
├── services/
├── socket/
└── utils/
