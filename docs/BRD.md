# Delivery Partner Allocation Engine

## Project Overview

The Delivery Partner Allocation Engine is a logistics optimization platform inspired by food delivery systems such as Swiggy and Zomato.

The platform automatically assigns delivery partners to incoming orders using a deterministic weighted scoring algorithm and generates AI-powered, human-readable explanations for each allocation decision.

The system is designed as a full-stack web application for administrators to manage riders, orders, allocations, and operational analytics.

---

## Problem Statement

Food delivery platforms receive large volumes of orders continuously.

Manual rider assignment is inefficient and does not scale.

The platform must automatically select the best available delivery partner for each order while considering:

* Geographic proximity
* Rider performance rating
* Current workload
* Availability status

---

## Business Goals

* Minimize delivery time by prioritizing nearby riders
* Maximize customer satisfaction by preferring highly rated riders
* Distribute workload fairly across riders
* Provide transparent allocation decisions
* Deliver operational visibility through a real-time dashboard

---

## Success Metrics

* Rider allocation time per order: less than 500 milliseconds
* API response time (P95): less than 1 second
* Dashboard load time: less than 2 seconds
* Backend uptime: greater than 99%
* AI explanations must be human-readable and factually correct

---

## User Roles

### Admin

Responsibilities:

* View all registered riders and their current status
* Create and manage orders
* Trigger rider allocation
* View allocation history
* Monitor live maps and operational metrics
* Review AI-generated explanations

### Delivery Partner

Responsibilities:

* Update availability status
* Update current location
* View assigned deliveries
* Mark deliveries as completed

---

## Core Features

### Rider Management

* Rider registration
* Availability management
* GPS location updates
* Performance ratings
* Active order tracking

### Order Management

* Create orders with restaurant and customer coordinates
* View and filter orders
* Track order status
* Associate riders with orders

### Allocation Engine

* Evaluate all available riders
* Calculate weighted scores
* Assign the highest-scoring rider
* Persist allocation history

### AI Explanation Module

* Generate plain-English explanations for allocation decisions
* Explain why the selected rider was chosen
* Provide transparency for administrators

### Dashboard and Maps

* Display operational KPIs
* Visualize riders and orders on a map
* Display allocation history
* Show delivery routes

---

## Technology Stack

### Frontend

* React (Vite)
* Material UI
* Axios
* Mapbox GL JS

### Backend

* Node.js
* Express.js

### Database

* MongoDB Atlas
* Mongoose

### Authentication

* JWT (JSON Web Tokens)

### AI

* Gemini API

### Deployment

* Frontend: Vercel
* Backend: Render

---

## Non-Functional Requirements

### Performance

* Allocation engine execution time must be less than 500 milliseconds for up to 100 riders.

### Scalability

* APIs must remain stateless.
* Backend must support horizontal scaling.

### Security

* JWT-based authentication is required.
* Protected API routes must enforce authorization.

### Maintainability

* Backend must follow MVC architecture.
* APIs must be documented.
* Business logic must be separated into services.

### Data Integrity

* Allocation history records are append-only.
* Historical allocation data must never be deleted.

---

## Out of Scope

The following features are excluded from this version:

* Real-time GPS tracking
* Customer-facing mobile applications
* Payment processing
* Rider earnings and incentives
* Machine learning-based allocation
* Multi-city support
* Multi-tenant support

---

## Deployment Targets

* Frontend: Vercel
* Backend: Render
* Database: MongoDB Atlas

---

## Project Objective

Build a maintainable, scalable logistics optimization platform that demonstrates:

* Full-stack application development
* Algorithmic decision-making
* AI-assisted explainability
* Real-time operational visualization
* Cloud deployment best practices
