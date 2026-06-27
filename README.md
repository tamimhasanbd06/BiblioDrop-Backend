# 📚 BiblioDrop – Online Book Delivery Management System (Backend)

BiblioDrop is a secure REST API built with **Node.js**, **Express.js**, **MongoDB Atlas**, and **Stripe**. It powers an online book delivery platform featuring authentication, role-based authorization, online payments, book management, and delivery tracking.

---

## 🚀 Live Links

* **Backend:** *Add your deployed backend URL*
* **Frontend:** *Add your deployed frontend URL*
* **Frontend Repository:** *Add frontend repository URL*

---

## 👤 Admin Credentials

> **For testing purposes only**

* **Email:** `admin@gmail.com`
* **Password:** `Admin@123`

---

## ✨ Features

* JWT Authentication
* Role-Based Access Control (User, Librarian, Admin)
* Secure HTTP-Only Cookie Authentication
* Stripe Payment Integration
* Book CRUD Operations
* Wishlist Management
* Book Borrow & Delivery Tracking
* Review & Rating System
* Search, Filter & Pagination
* MongoDB Aggregation
* Protected API Routes
* Environment Variable Configuration

---

## 🛠️ Tech Stack

* Node.js
* Express.js
* MongoDB Atlas
* JWT
* Stripe
* Cookie Parser
* CORS
* Dotenv

---

## 📦 Installation

```bash
git clone <repository-url>
cd BiblioDrop-Backend
npm install
```

---

## ▶️ Run Development Server

```bash
npm run dev
```

or

```bash
npm start
```

---

## 🔐 Environment Variables

Create a `.env` file in the project root.

```env
PORT=8000

MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/

MONGODB_DB=bibliodrop

JWT_SECRET=your_secure_jwt_secret

STRIPE_SECRET_KEY=your_stripe_secret_key

CLIENT_URL=http://localhost:3000

JWT_COOKIE_NAME=bd_token
```

> **Never commit your real API keys or secrets to GitHub.**

---

## 📁 Project Structure

```
├── index.js
├── package.json
├── .env
├── README.md
├── middleware
├── routes
├── utils
└── node_modules
```

---

## 📦 Dependencies

* express
* mongodb
* jsonwebtoken
* stripe
* dotenv
* cors
* cookie-parser

---

## 📄 License

This project is developed for educational purposes.
