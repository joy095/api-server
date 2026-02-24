# Clinic API

REST API for clinic/doctor appointment management built with **Hono**, **Drizzle ORM**, **better-auth**, and **Zod**.

## Quick Start

```bash
cp .env.example .env        # fill in your values
bun install
bun db:push                 # push schema to DB (dev)
bun db:seed                 # optional seed data
bun dev                     # start with hot reload
```

## Project Structure

```
src/
├── index.ts                   # App entry, middleware, route mounting
├── lib/
│   ├── auth.ts                # better-auth config
│   ├── db.ts                  # Drizzle + pg pool
│   ├── env.ts                 # Env validation (Zod)
│   └── response.ts            # ok/created/paginated helpers + AppError
├── middleware/
│   ├── index.ts               # errorHandler, requireAuth, requireRole,
│   │                          # validateBody, validateQuery, csrfProtection
│   ├── rate-limit.ts          # In-memory rate limiter
│   └── ownership.ts           # Doctor self-access guard
├── validators/
│   └── index.ts               # All Zod schemas
├── types/
│   └── index.ts               # Drizzle-inferred TS types
├── services/
│   └── availability.service.ts # Slot generation logic
├── controllers/
│   ├── doctor.controller.ts
│   ├── clinic.controller.ts
│   ├── availability.controller.ts
│   ├── slots.controller.ts
│   ├── patient.controller.ts
│   ├── booking.controller.ts
│   └── appointment-type.controller.ts
├── routes/
│   ├── doctor.routes.ts
│   ├── other.routes.ts        # clinics, patients, bookings
│   └── admin.routes.ts
└── scripts/
    └── seed.ts
```

---

## Authentication

All protected routes require a session cookie from better-auth.

```
POST /api/auth/sign-up/email      { name, email, password }
POST /api/auth/sign-in/email      { email, password }
POST /api/auth/sign-out
GET  /api/auth/session
```

**Roles:** `admin` · `doctor` · `staff`

---

## API Reference

Base URL: `/api/v1`

---


## 🏢 Organisation-Scoped Role Isolation

Roles are **per-organisation**, not global. A user who is `admin` in *Clinic A* has **no elevated access** in *Clinic B*.

### How it works

1. **better-auth** manages the `organization`, `member`, and `invitation` tables.
2. On every authenticated request, `requireAuth` middleware:
   - Validates the bearer token via `auth.api.getSession()`
   - Reads `session.activeOrganizationId`
   - Looks up `member.role` for that `(userId, organizationId)` pair
   - Stores the resolved `AuthUser` (with `organizationId` + `role`) in Hono context
3. `requireRole(...roles)` checks the **org-scoped role**, not `user.role` (global)
4. `requireOrg` guard ensures `organizationId` is present before accessing any resource

### Org Roles

| Role | Description |
|------|-------------|
| `owner` | Full control — manage members, delete org |
| `admin` | Manage members, invite users, CRUD all resources |
| `doctor` | Read all org data; write own availability/appointment types |
| `staff` | Create/edit patients and bookings; read-only on doctors |

### Setting the active org (client-side)

```typescript
// Switch active organisation — sets session.activeOrganizationId
await authClient.organization.setActive({ organizationId: "org-uuid" })
```

---

## 📡 Server-Sent Events (SSE) — Live Queue Updates

Patients and staff can subscribe to real-time booking updates for a doctor's queue.

---


### SSE Events

| Event | Sent when | Payload includes |
|-------|-----------|-----------------|
| `connected` | On subscribe | `doctorId`, `date`, `message` |
| `booking_created` | New booking added | `bookingId`, `serial`, `status` |
| `booking_updated` | Status change (confirmed, completed…) | `bookingId`, `serial`, `status` |
| `booking_cancelled` | Booking cancelled or deleted | `bookingId` |
| `ping` | Every 25 s (keepalive) | `ts` |

### Browser usage

```typescript
// Standard EventSource (no auth header support — use a polyfill or fetch-based SSE)
import { EventSourcePolyfill } from 'event-source-polyfill';

const es = new EventSourcePolyfill(
  `https://api.example.com/api/v1/sse/queue/${doctorId}?date=2025-06-01`,
  { headers: { Authorization: `Bearer ${token}` } }
);

es.addEventListener('booking_created', (e) => {
  const event = JSON.parse(e.data);
  console.log('New booking #', event.serial);
});

es.addEventListener('booking_updated', (e) => {
  const event = JSON.parse(e.data);
  console.log('Booking', event.bookingId, 'is now', event.status);
});

// Clean up on unmount
es.close();
```

### Publishing events

Events are published automatically whenever a booking is **created**, **updated** (status change), or **deleted** via the booking controller. No extra work needed.

---


### Doctors
| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/v1/doctors` | any member |
| GET | `/api/v1/doctors/:id` | any member |
| POST | `/api/v1/doctors` | owner, admin |
| PATCH | `/api/v1/doctors/:id` | owner, admin |
| DELETE | `/api/v1/doctors/:id` | owner, admin |
| GET | `/api/v1/doctors/:id/slots` | any member |
| GET | `/api/v1/doctors/:id/bookings` | admin, doctor (own) |
| POST | `/api/v1/doctors/:id/bookings` | all authenticated |

### Bookings
| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/v1/bookings` | admin, doctor, staff |
| GET | `/api/v1/bookings/:id` | any member |
| POST | `/api/v1/bookings` | all authenticated |
| PATCH | `/api/v1/bookings/:id` | admin, doctor, staff |
| DELETE | `/api/v1/bookings/:id` | owner, admin |

### SSE
| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/v1/sse/queue/:doctorId?date=` | any authenticated |

### Admin
| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/v1/admin/users` | owner, admin |
| GET | `/api/v1/admin/users/:id` | owner, admin |
| PATCH | `/api/v1/admin/users/:id/role` | owner, admin |
| DELETE | `/api/v1/admin/users/:id` | owner, admin |
| GET | `/api/v1/admin/stats` | owner, admin |

### Doctors

| Method   | Path                                      | Auth         | Description                    |
|----------|-------------------------------------------|--------------|--------------------------------|
| `GET`    | `/doctors`                                | Public       | List doctors (paginated)       |
| `GET`    | `/doctors/:id`                            | Public       | Get doctor with relations      |
| `POST`   | `/doctors`                                | admin        | Create doctor                  |
| `PATCH`  | `/doctors/:id`                            | admin        | Update doctor                  |
| `DELETE` | `/doctors/:id`                            | admin        | Delete doctor                  |
| `POST`   | `/doctors/:id/clinics`                    | admin        | Assign doctor to clinic        |
| `DELETE` | `/doctors/:id/clinics/:clinicId`          | admin        | Remove doctor from clinic      |

**Query params** — `GET /doctors`: `?page=1&limit=20&specialist=Cardiology`

---

### Availability Rules

| Method   | Path                                      | Auth              | Description              |
|----------|-------------------------------------------|-------------------|--------------------------|
| `GET`    | `/doctors/:id/availability`               | auth              | List rules for doctor    |
| `GET`    | `/doctors/:id/availability/:ruleId`       | auth              | Get single rule          |
| `POST`   | `/doctors/:id/availability`               | admin, doctor     | Create rule              |
| `PATCH`  | `/doctors/:id/availability/:ruleId`       | admin, doctor     | Update rule              |
| `DELETE` | `/doctors/:id/availability/:ruleId`       | admin, doctor     | Soft-delete rule         |

**Query params** — `GET /availability`: `?clinicId=&active=true`

**Create body:**
```json
{
  "clinicId": "uuid",
  "recurrentType": "weekly",
  "dayOfWeek": 1,
  "startTime": "09:00",
  "endTime": "17:00",
  "breaks": [{ "start": 720, "end": 780 }]
}
```

---

### Slots (Availability Calendar)

| Method | Path                              | Auth   | Description                    |
|--------|-----------------------------------|--------|--------------------------------|
| `GET`  | `/doctors/:id/slots`              | Public | Get time slots for a date      |
| `GET`  | `/doctors/:id/slots/next`         | Public | Find next date with open slots |

**Query params:**
- `/slots?clinicId=uuid&date=2025-01-15&slotDuration=15`
- `/slots/next?clinicId=uuid&from=2025-01-15&maxDays=30`

**Response:**
```json
{
  "date": "2025-01-15",
  "slots": [
    { "start": "09:00", "end": "09:15", "available": true, "serial": 1 },
    { "start": "09:15", "end": "09:30", "available": false, "serial": 2 }
  ]
}
```

---

### Appointment Types

| Method   | Path                                          | Auth          | Description   |
|----------|-----------------------------------------------|---------------|---------------|
| `GET`    | `/doctors/:id/appointment-types`              | Public        | List types    |
| `POST`   | `/doctors/:id/appointment-types`              | admin, doctor | Create type   |
| `PATCH`  | `/doctors/:id/appointment-types/:typeId`      | admin, doctor | Update type   |
| `DELETE` | `/doctors/:id/appointment-types/:typeId`      | admin, doctor | Delete type   |

---

### Bookings (Queue)

| Method   | Path                          | Auth              | Description                    |
|----------|-------------------------------|-------------------|--------------------------------|
| `GET`    | `/doctors/:id/bookings`       | auth              | Doctor's daily queue           |
| `GET`    | `/doctors/:id/bookings/stats` | admin,doctor,staff| Daily/weekly stats             |
| `POST`   | `/doctors/:id/bookings`       | auth              | Create booking (auto serial)   |
| `GET`    | `/bookings`                   | admin,doctor,staff| List all bookings (filtered)   |
| `GET`    | `/bookings/:id`               | auth              | Get single booking             |
| `PATCH`  | `/bookings/:id`               | admin,doctor,staff| Update status / cancel         |
| `DELETE` | `/bookings/:id`               | admin             | Hard delete                    |

**Doctor queue params:** `?date=2025-01-15&status=pending`

**Booking filter params:** `?doctorId=&clinicId=&patientId=&status=&date=&page=&limit=`

**Create booking body:**
```json
{
  "clinicId": "uuid",
  "patientId": "uuid",
  "appointmentTypeId": "uuid",
  "bookVia": "web",
  "serialDate": "2025-01-15",
  "scheduledAt": "2025-01-15T09:00:00Z"
}
```

**Update booking body:**
```json
{
  "bookingStatus": "cancelled",
  "cancelNote": "Patient requested reschedule"
}
```

---

### Clinics

| Method   | Path           | Auth  | Description               |
|----------|----------------|-------|---------------------------|
| `GET`    | `/clinics`     | Public| List clinics              |
| `GET`    | `/clinics/:id` | Public| Get clinic with doctors   |
| `POST`   | `/clinics`     | admin | Create clinic             |
| `PATCH`  | `/clinics/:id` | admin | Update clinic             |
| `DELETE` | `/clinics/:id` | admin | Delete clinic             |

**Query params:** `?search=downtown&page=1&limit=20`

---

### Patients

| Method   | Path                    | Auth              | Description              |
|----------|-------------------------|-------------------|--------------------------|
| `GET`    | `/patients`             | admin,doctor,staff| List patients            |
| `GET`    | `/patients/:id`         | admin,doctor,staff| Get patient              |
| `GET`    | `/patients/:id/bookings`| admin,doctor,staff| Patient booking history  |
| `POST`   | `/patients`             | auth              | Create patient           |
| `PATCH`  | `/patients/:id`         | admin,staff       | Update patient           |
| `DELETE` | `/patients/:id`         | admin             | Delete patient           |

**Query params:** `?search=alice&page=1&limit=20`

---

### Admin

| Method   | Path                      | Auth  | Description              |
|----------|---------------------------|-------|--------------------------|
| `GET`    | `/admin/users`            | admin | List all users           |
| `GET`    | `/admin/users/:id`        | admin | Get single user          |
| `PATCH`  | `/admin/users/:id/role`   | admin | Change user role         |
| `DELETE` | `/admin/users/:id`        | admin | Delete user              |
| `GET`    | `/admin/stats`            | admin | System-wide stats        |

---

## Pagination

All list endpoints return:
```json
{
  "success": true,
  "data": [...],
  "meta": { "total": 100, "page": 1, "limit": 20, "pages": 5 }
}
```

## Error Responses

```json
{ "success": false, "error": "Doctor not found" }          // 404
{ "success": false, "error": "Validation failed",
  "issues": { "email": ["Invalid email"] } }               // 422
{ "success": false, "error": "Unauthorized" }              // 401
{ "success": false, "error": "Forbidden" }                 // 403
{ "success": false, "error": "Too many requests..." }      // 429
```

## Rate Limits

| Scope          | Limit           |
|----------------|-----------------|
| General API    | 100 req / min   |
| Auth endpoints | 10 req / 15 min |
| Booking create | 20 req / min    |# api-server
# api-server
# api-server
# api-server
# api-server
# api-server
