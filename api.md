# API Routes Documentation

Base URL: `/api/v1`

## Authentication

Auth endpoints are mounted at `/api/auth/**` by better-auth.

| Method | Path | Description |
|---|---|---|
| ALL | `/api/auth/**` | better-auth managed routes (sign-in, sign-out, session, organization, etc.) |

## System

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/v1/health` | Public | Health check |

## Clinics

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/v1/clinics/marketplace` | Public | - | Public clinic marketplace listing (supports `page`, `limit`) |
| GET | `/api/v1/clinics` | Required | Any org member | List clinics |
| GET | `/api/v1/clinics/:id` | Required | Any org member | Get clinic by ID |
| POST | `/api/v1/clinics` | Required | owner/admin | Create clinic |
| POST | `/api/v1/clinics/:id/members` | Required | owner/admin | Update an organization member to `admin`, `doctor`, or `staff` |
| PATCH | `/api/v1/clinics/:id` | Required | owner/admin | Update clinic |
| DELETE | `/api/v1/clinics/:id` | Required | owner/admin | Delete clinic |

## Doctors

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/v1/doctors` | Required | Any org member | List doctors |
| GET | `/api/v1/doctors/:id` | Required | Any org member | Get doctor by ID |
| POST | `/api/v1/doctors` | Required | owner/admin | Create doctor |
| PATCH | `/api/v1/doctors/:id` | Required | owner/admin | Update doctor |
| DELETE | `/api/v1/doctors/:id` | Required | owner/admin | Delete doctor |
| POST | `/api/v1/doctors/:id/clinics` | Required | owner/admin | Assign doctor to clinic |
| DELETE | `/api/v1/doctors/:id/clinics/:clinicId` | Required | owner/admin | Remove doctor from clinic |

## Doctor Availability

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/v1/doctors/:id/availability` | Required | Any org member | List availability rules |
| GET | `/api/v1/doctors/:id/availability/:ruleId` | Required | Any org member | Get availability rule |
| POST | `/api/v1/doctors/:id/availability` | Required | owner/admin/doctor (self or admin) | Create availability rule |
| PATCH | `/api/v1/doctors/:id/availability/:ruleId` | Required | owner/admin/doctor (self or admin) | Update availability rule |
| DELETE | `/api/v1/doctors/:id/availability/:ruleId` | Required | owner/admin/doctor (self or admin) | Delete availability rule |

## Appointment Types

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/v1/doctors/:id/appointment-types` | Required | Any org member | List appointment types |
| POST | `/api/v1/doctors/:id/appointment-types` | Required | owner/admin/doctor (self or admin) | Create appointment type |
| PATCH | `/api/v1/doctors/:id/appointment-types/:typeId` | Required | owner/admin/doctor (self or admin) | Update appointment type |
| DELETE | `/api/v1/doctors/:id/appointment-types/:typeId` | Required | owner/admin/doctor (self or admin) | Delete appointment type |

## Patients

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/v1/patients` | Required | owner/admin/doctor/staff | List patients |
| GET | `/api/v1/patients/:id` | Required | owner/admin/doctor/staff | Get patient by ID |
| GET | `/api/v1/patients/:id/bookings` | Required | owner/admin/doctor/staff | Get patient bookings |
| POST | `/api/v1/patients` | Required | owner/admin/doctor/staff | Create patient |
| PATCH | `/api/v1/patients/:id` | Required | owner/admin/staff | Update patient |
| DELETE | `/api/v1/patients/:id` | Required | owner/admin | Delete patient |

## Bookings

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/v1/bookings` | Required | owner/admin/doctor/staff | List bookings |
| GET | `/api/v1/bookings/:id` | Required | Any org member | Get booking by ID |
| POST | `/api/v1/bookings` | Required | Any org member | Create booking with `doctorId` in body |
| PATCH | `/api/v1/bookings/:id` | Required | owner/admin/doctor/staff | Update booking status/details |
| DELETE | `/api/v1/bookings/:id` | Required | owner/admin | Delete booking |
| GET | `/api/v1/doctors/:id/bookings` | Required | owner/admin/doctor/staff (self or admin) | Doctor queue listing |
| GET | `/api/v1/doctors/:id/bookings/stats` | Required | owner/admin/doctor/staff (self or admin) | Doctor booking stats |
| POST | `/api/v1/doctors/:id/bookings` | Required | Any org member | Create booking for doctor |

## Admin

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/v1/admin/users` | Required | owner/admin | List organization users |
| GET | `/api/v1/admin/users/:id` | Required | owner/admin | Get organization user |
| PATCH | `/api/v1/admin/users/:id/role` | Required | owner/admin | Update organization role (+ optional doctor profile link) |
| DELETE | `/api/v1/admin/users/:id` | Required | owner/admin | Remove organization member |
| GET | `/api/v1/admin/stats` | Required | owner/admin | Organization stats |

## SSE

| Method | Path | Auth | Role | Description |
|---|---|---|---|---|
| GET | `/api/v1/sse/queue/:doctorId` | Required | Any authenticated user | Subscribe to live queue updates (`?date=YYYY-MM-DD`) |

