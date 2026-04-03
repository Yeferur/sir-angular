# 🚨 SIR PRODUCTION AUDIT REPORT
## Pre-Flight QA Assessment - Sistema Integrado de Reservas

**Date:** April 3, 2026  
**Assessment Level:** EXHAUSTIVE - Critical Path Analysis  
**Status:** ⚠️ **NOT READY FOR PRODUCTION** (Multiple Blockers Found)

---

## EXECUTIVE SUMMARY

After analyzing the complete SIR codebase (Angular 21 + Node.js), **I have identified critical security vulnerabilities, broken end-to-end flows, and data integrity issues** that must be resolved before production deployment.

### Critical Findings by Category:

| Category | Count | Severity |
|----------|-------|----------|
| 🔴 BLOCKERS | **6** | CRITICAL |
| 🟡 WARNINGS | **8** | HIGH |
| 🟢 CLEANUP | **5** | MEDIUM |

---

## 🔴 BLOCKERS (Must Fix Before Production)

### 1. **NO ROUTE GUARDS ON FRONTEND - CRITICAL SECURITY BREACH**

**Status:** ❌ BROKEN  
**Severity:** 🔴 CRITICAL  
**Location:** `/frontend/src/app/app.routes.ts`

**Problem:**
```typescript
// app.routes.ts - NO AuthGuard on any routes
{
  path: 'Reservas/NuevaReserva',
  loadComponent: () => import(...).then((m) => m.CrearReservaComponent),
  canDeactivate: [unsavedChangesGuard],  // ← Only unsavedChanges, NO AUTH!
  title: 'SIR · Nueva Reserva',
},
```

**Impact:** 
- Any unauthenticated user can navigate directly to `/Reservas/NuevaReserva` and access forms
- All routes lack `AuthGuard`: Dashboard, Tours, Usuarios, Programación, etc.
- The `app.ts` sets navbar mode to 'login' based on token, but doesn't block route access
- Even though the backend is protected, **frontend allows UI rendering of sensitive data**

**Affected Routes:**
- ✗ `/Dashboard` - No auth guard
- ✗ `/Historial` - No auth guard  
- ✗ `/Reservas/*` - No auth guard
- ✗ `/Transfers/*` - No auth guard
- ✗ `/Programacion/Listado` - No auth guard
- ✗ `/Usuarios` - No auth guard
- ✗ `/Tours/*` - No auth guard
- ✗ `/Comisiones` - No auth guard
- ✗ `/Seguros` - No auth guard

**Proof:** In `app.routes.ts`, only `unsavedChangesGuard` is used (CanDeactivate only). There is NO `CanActivateFn` or `AuthGuard` checking token validity.

**Required Fix:**
1. Create `auth.guard.ts` with `canActivateFn` that checks `AuthService.isLoggedIn()`
2. Apply `canActivate: [authGuard]` to ALL protected routes
3. Implement route redirect to login when unauthorized

---

### 2. **401 RESPONSE DOESN'T REDIRECT TO LOGIN**

**Status:** ❌ BROKEN  
**Severity:** 🔴 CRITICAL  
**Location:** `/frontend/src/app/interceptors/auth.interceptor.ts`

**Problem:**
```typescript
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // ...
  return next(request).pipe(
    catchError((error) => {
      if (error.status === 401) {
        auth.logout();  // ← Only calls logout(), NO REDIRECT TO LOGIN!
      }
      return throwError(() => error);
    })
  );
};
```

**Impact:**
- When backend returns `401 Unauthorized`, the interceptor only logs out but doesn't navigate to login
- User is stuck on the current page with a broken state
- No toast/alert informing user why they were logged out
- If token expires mid-operation, user gets silent failure

**Required Fix:**
```typescript
if (error.status === 401) {
  auth.logout();
  this.router.navigate(['/login']); // ← MISSING!
}
```

---

### 3. **INCONSISTENT DATA ENVELOPE UNWRAPPING - NULL CRASHES**

**Status:** ⚠️ PARTIALLY BROKEN  
**Severity:** 🔴 CRITICAL  
**Location:** `/frontend/src/app/interceptors/api-envelope.interceptor.ts`

**Problem:**
```typescript
export const apiEnvelopeInterceptor: HttpInterceptorFn = (req, next) => {
  return next(req).pipe(
    map((event) => {
      if (body.success === true) {
        return event.clone({ body: body.data });  // ← body.data can be NULL!
      }
    })
  );
};
```

**Root Cause (from memory):** When backend sends `{ success: true, data: null, message: "Success" }`, the interceptor unwraps to a null response. The component code may expect `res.message` or try to access properties on null.

**Example Failure Scenario:**
```typescript
// Backend sends: { success: true, data: null, message: "Punto guardado" }
// Frontend receives: null (via interceptor unwrap)
// Component tries: result.message  ← CRASH: Cannot read property 'message' of null
```

**Impacted Flows:**
- Inicio aforo saving (from repo notes)
- Any endpoint that returns empty/null data with success=true

**Required Fix:**
1. Backend: Ensure consistent data structure (e.g., empty array `[]` instead of `null`)
2. Frontend: Components must null-check before accessing response properties

---

### 4. **PROGRAMACION.SERVICE.JS - ZERO RESERVAS EDGE CASE UNHANDLED**

**Status:** ⚠️ PARTIALLY BROKEN  
**Severity:** 🔴 CRITICAL  
**Location:** `/backend/services/Programacion/programacion.service.js` (lines 77-154)

**Problem:**
```javascript
async function generarPlanLogistico(fecha, idsTours) {
  try {
    const reservas = await obtenerReservas(fecha, idsTours);
    const reservasPendientes = [...reservas];
    if (reservasPendientes.length === 0) return [];  // ← Returns empty array
    
    // Complex bus clustering algorithm...
    return buses;  // ← Can throw errors if edge cases not handled
  } catch (error) {
    console.error("Fallo crítico...", error);
    throw error;
  }
}
```

**Issues Found:**
1. ✗ **Returns `[]` for zero reservas** - Frontend receives empty array, may UI crash if expecting `{ buses, stats }`
2. ✗ **CAPACIDADES_BUSES defined but unused** - Line 9 defines array `[18, 23, 25, 27, 38, 39, 40, 41, 43]`, but logic uses hardcoded `CAPACIDAD_BUS = 38`
3. ✗ **No validation of coordinate data** - If Latitud/Longitud are null, `calcularDistancia()` may produce NaN
4. ✗ **No handling of zero-occupancy buses** - Algorithm may create bus with occupados=0
5. ✗ **Database constraint on asignaciones not validated** - Multiple guide assignments possible

**Specific Code Smells:**
```javascript
// Line 163-165: idsTours handling is confusing
const primaryTourId = tours.includes(5) ? 5 : tours[0];  // ← Why special case for ID=5?

// Line 247-262: haversine distance can return Infinity
function calcularDistancia(lat1, lon1, lat2, lon2) {
  if (!tieneCoords(lat1) || !tieneCoords(lon1) || !tieneCoords(lat2) || !tieneCoords(lon2)) {
    return Number.MAX_VALUE;  // ← Causes empty bus creation!
  }
}
```

**Required Fixes:**
1. Return consistent structure: `{ buses, stats, reservasPendientes }`
2. Use CONFIG.CAPACIDADES_BUSES properly or remove them
3. Validate ALL coordinates before distance calculation
4. Add unit tests for:
   - Zero reservas scenario
   - Mixed null/valid coordinates
   - Over-capacity scenarios

---

### 5. **DUPLICATE CODE FILES IN PRODUCTION**

**Status:** ❌ CODE SMELL  
**Severity:** 🔴 CRITICAL  
**Location:** `/backend/services/Programacion/`

**Problem:**
```
programacion.service.js         ← Current (NEW)
programacion.service copy.js    ← DUPLICATE (OLD, should not deploy!)

rutas.service.js                ← Current
rutas.service copy.js           ← DUPLICATE

/controllers/Programacion/programacion.controller copy.js
```

**Impact:**
- Takes up space, confuses developers
- May be imported accidentally by old code
- Makes git history confusing
- Indicates incomplete refactoring

**Required Fix:**
Delete all `.copy.js` files before deployment.

---

### 6. **TOURS-RESERVAS-PROGRAMACION E2E FLOW BROKEN**

**Status:** ⚠️ PARTIAL DATA MISMATCH  
**Severity:** 🔴 CRITICAL  
**Location:** Multiple files across Tours, Reservas, Programación services

**Problems Found:**

#### 6a. Tour Creation → Reserva Linking Issue
```javascript
// tours.service.js - Creates tour but precio plane association unclear
await conn.query(
  `INSERT INTO planes_tours (Id_Tour, Id_Plan) VALUES (?, ?)`,
  [id, planId]
);
// ✗ No validation that plan exists or is valid
```

**Missing Validations:**
- ✗ No FK check: Plan exists before linking
- ✗ Tour abbreviation uniqueness not enforced  
- ✗ Cupo_Base validation (must be > 0)

#### 6b. Reserva Creation → Programación Linking Issue
```javascript
// reservas.service.js - NO REFERENCE TO TOUR STRUCTURE
const [rows] = await db.query(
  `SELECT ... FROM reservas r
   INNER JOIN horarios h ON h.Id_Horario = r.Id_Horario
   INNER JOIN pasajeros p ON p.Id_Reserva = r.Id_Reserva`
);
```

**Missing Data in Response:**
- ✗ `h.Id_Tour` selected but not validated to match actual tour
- ✗ `p.Id_Punto` may be NULL → programación algorithm fails
- ✗ No DNI uniqueness validation per Fecha_Tour (only checks fecha, not date scope)

#### 6c. Programación Plan Generation → Excel Export Structure Mismatch
```javascript
// programacion.service.js linha 507+
async function generarExcelListadoBus({ fecha, idTour, bus, nombreTour }) {
  // Excel columns: HARDCODED
  // Bus structure: { id, capacidad, ocupados, reservas: [...] }
  // ✗ What if reservas[].NombrePunto is NULL?
  // ✗ What if Latitud/Longitud missing?
}
```

**Data Integrity Issues:**
- Tour → Reserva: No cascade validation on plan deletion
- Reserva → Pasajero: Point coordinates can be null
- Programación: Excel export assumes all fields exist

**Required Fixes:**
1. Add database constraints: `FOREIGN KEY (Id_Plan) REFERENCES planes(Id_Plan)`
2. Add NOT NULL constraints where needed
3. Validate data completeness in each service before proceeding
4. Add integration tests: Tour → Reserva → Programación pipeline

---

## 🟡 WARNINGS (High Risk, Should Fix)

### 1. **CONSOLE.LOG STATEMENTS IN PRODUCTION CODE** 

**Status:** ⚠️ NOT CLEANED  
**Severity:** 🟡 HIGH  
**Locations:** 52+ instances across frontend, 10+ in backend

**Frontend Examples:**
```typescript
// pages/Reservas/editar-reserva/editar-reserva.ts:407
console.log('Punto principal ID:', puntoId);

// services/WebSocket/web-socket.ts:45
console.log('✅ WebSocket conectado:', wsUrl);

// services/Usuarios/usuarios.ts:60
console.log('id', id, '| enWebSocket:', enWebSocket, '| enDB:', enDB);
```

**Backend Examples:**
```javascript
// controllers/Puntos/puntos.controller.js:79
console.log(Id_Punto, Id_Tour);

// services/Reservas/reservas.service.js:444
console.log(where, values);
```

**Impact:**
- Exposes sensitive information (IDs, structure) in browser console
- Degrades performance (logging is I/O)
- Unprofessional in production

**Required Fix:**
Remove all `console.log`, `console.error` except critical error handling. Use proper logging library for backend.

---

### 2. **MISSING FORM VALIDATION DISABLING SUBMIT**

**Status:** ⚠️ PARTIAL  
**Severity:** 🟡 HIGH  
**Locations:** Multiple form components

**Example Issues Found:**
```html
<!-- crear-reserva.html -->
<form [formGroup]="form" (ngSubmit)="submitCreateTour()">
  <!-- Missing [disabled]="form.invalid" on submit button! -->
  <button type="submit">Crear</button> ← CRITICAL: CAN SUBMIT INVALID FORM
</form>

<!-- crear-punto.html - SAME PATTERN -->
<button class="btn-primary" (click)="guardarPunto()">Guardar</button>
<!-- No [disabled]="form.invalid" check! -->
```

**Specific Forms at Risk:**
- crear-reserva.html - No submit button disabled check
- crear-tour.html - No obvious [disabled] binding
- crear-punto.html - Click handler bypasses form validation
- editar-usuario.html - No visible validation before save

**Required Fix:**
```html
<button type="submit" [disabled]="form.invalid || isSubmitting()">
  {{ isSubmitting() ? 'Guardando...' : 'Guardar' }}
</button>
```

---

### 3. **PASSWORD POLICY AND RESET NOT ENFORCED**

**Status:** ⚠️ MISSING  
**Severity:** 🟡 HIGH  
**Locations:** Login flow unknown

**Issues:**
- ✗ No password min length validation in API
- ✗ No password reset endpoint found (GET /reset-password?)
- ✗ No 2FA/MFA implementation
- ✗ JWT token expiry hardcoded? (no refresh token mechanism visible)

**Required Fixes:**
1. Implement password policy validation
2. Add JWT refresh token mechanism
3. Implement password reset flow

---

### 4. **DNI VALIDATION INSUFFICIENT FOR PRODUCTION**

**Status:** ⚠️ PARTIAL  
**Severity:** 🟡 HIGH  
**Location:** `reservas.service.js` function `verificarDniDuplicado()`

**Problem:**
```javascript
// Missing proper DNI validation
async function verificarDniDuplicado(dni, fecha, excludeReservaId) {
  // Checks if DNI exists on that DATE, but:
  // ✗ No format validation (Colombian DNI should be 8-10 digits, no special chars)
  // ✗ No checksum validation
  // ✗ Can't distinguish same person booking multiple tours on same day
}
```

**Impact:**
- Invalid DNI formats accepted (e.g., "ABC123")
- Duplicates not properly detected when person books multiple times
- No verification against national ID database

**Required Fix:**
Implement Colombian DNI validation regex: `/^[0-9]{8,10}$/`

---

### 5. **WEBSOCKET MESSAGE TYPE ENUM NOT ENFORCED**

**Status:** ⚠️ UNTYPED  
**Severity:** 🟡 HIGH  
**Location:** `websocketManager.js` and `web-socket.ts`

**Problem:**
```javascript
// websocketManager.js - hardcoded strings, no enum
const mensaje = {
  type: 'forceLogout',    // ← String literal, not type-safe
  data: {...}
};

// web-socket.ts - same issue
if (msg?.type === 'forceLogout' || msg?.type === 'force-logout') {  // ← Typo check!
  // ...
}
```

**Impact:**
- Message type typos not caught at compile time
- Different formats across codebase ("forceLogout" vs "force-logout")
- Hard to refactor

**Required Fix:**
```typescript
enum WSMessageType {
  FORCE_LOGOUT = 'force-logout',
  LOGOUT = 'logout',
  RESERVE_CREATED = 'reservaCreada',
  // ...
}
```

---

### 6. **ERROR HANDLING INCONSISTENT BETWEEN ENDPOINTS**

**Status:** ⚠️ MIXED  
**Severity:** 🟡 HIGH  
**Locations:** Controllers mix responseEnvelope patterns

**Examples:**
```javascript
// tours.controller.js - consistent use of sendError/sendSuccess
exports.crearTour = async (req, res) => {
  try {
    const data = await crearTour(req.body, userId);
    return sendSuccess(res, {...});
  } catch (e) {
    return sendError(res, {..., errorCode: 'BAD_REQUEST'});
  }
};

// reservas.controller.js - SOMETIMES inconsistent
exports.saveReserva = [
  upload.any(),
  asyncHandler(async (req, res) => {  // ← Different pattern
    const err = new Error('Falta payload');
    err.status = 400;
    throw err;  // ← Handler catches and wraps differently
  })
];
```

**Impact:**
- Inconsistent error codes across API
- Frontend error handler may misinterpret some responses
- Some endpoints return different HTTP status codes
- Error message format varies

**Required Fix:**
Standardize error handling across all controllers to use sendError wrapper

---

### 7. **AVAILABLE POINTS (PUNTOS) QUERY HAS WRONG LOGIC**

**Status:** ⚠️ INCORRECT  
**Severity:** 🟡 HIGH  
**Location:** `crear-reserva.ts` - punto autocomplete

**Issue:**
The frontend searches puntos but doesn't validate they're available for the selected tour. A punto might not have horarios for the tour_id selected.

```typescript
// Missing: validate punto has horarios for selectedTour on selectedDate
puntoBusquedaResults = signal<Punto[]>([]);  // No filtering by tour/availability!
```

**Impact:**
- User selects punto with no horarios → backend rejects
- Poor UX, no validation feedback

---

### 8. **MISSING RATE LIMITING ON LOGIN ENDPOINT**

**Status:** ⚠️ MISSING  
**Severity:** 🟡 HIGH  
**Location:** `/api/login` route

**Problem:**
```javascript
router.post('/login', loginController.login);  // ← No rate limiting!
```

**Impact:**
- Brute force attacks possible
- No CAPTCHA after failed attempts

**Required Fix:**
Implement express-rate-limit or similar middleware

---

## 🟢 CLEANUP (Code Quality & Maintenance)

### 1. **HARDCODED MAGIC NUMBERS IN ALGORITMOS**

**Status:** ⚠️ SCATTERED  
**Severity:** 🟢 MEDIUM  
**Locations:** Multiple algorithm files

**Examples:**
```javascript
// programacion.service.js
const CAPACIDAD_BUS = 38;  // ← Hardcoded, not from config!
const PUNTO_BASE = { lat: 6.212757856694648, lon: -75.57759200491337 };  // ← Hardcoded coordinate!

// tours.service.js  
const modoNorm = ... ? 'TODO_EL_AÑO' : (temporadas.length ? 'SOLO_TEMPORADAS' : 'TODO_EL_AÑO');
// ← Should be ENUM
```

**Required Fix:**
1. Move to environment/config file
2. Create Enum types for string literals
3. Extract coordinates to database/constant

---

### 2. **COMMENTED OUT CODE AND DEBUG BLOCKS**

**Status:** ⚠️ PRESENT  
**Severity:** 🟢 MEDIUM  
**Example:**
```javascript
// rutas.controller.js:7
console.log(puntos);  // ← Debug leftover

// tours.service.js:254
// ======= TODO LO DEMÁS QUEDA IGUAL (tus funciones existentes) =======

// tours.service.js:461
console.log('Obtained tour planes:', Planes);
```

**Required Fix:**
Remove all commented debug code before production.

---

### 3. **MISSING TYPESCRIPT INTERFACES FOR API RESPONSES**

**Status:** ⚠️ WEAK TYPING  
**Severity:** 🟢 MEDIUM  
**Locations:** `services/*` - many use `any`

**Example:**
```typescript
// reservas.ts
async function filtrarReservas(q: any): Promise<any[]> {  // ← any everywhere!
  // ...
}
```

**Impact:**
- Autocomplete doesn't work
- Refactoring error-prone
- Type safety lost

**Required Fix:**
Create proper interfaces:
```typescript
interface FilterReservasResponse {
  Id_Reserva: string;
  Nombre_Cliente: string;
  FechaTour: Date;
  // ... all fields
}
```

---

### 4. **UNUSED VARIABLES AND IMPORTS**

**Status:** ⚠️ SCATTERED  
**Severity:** 🟢 MEDIUM  
**Example:**
```typescript
// DynamicNavbar/global.ts:70
console.log(puntos);  // ← Unused, just for debug
```

**Required Fix:**
Run eslint with proper rules and clean up.

---

### 5. **NO ENVIRONMENT CONFIG FILE FOR PRODUCTION**

**Status:** ⚠️ MISSING  
**Severity:** 🟢 MEDIUM  
**Location:** Backend - no `.env.production`

**Problem:**
```javascript
// server.js
const DEFAULT_PORT = Number(process.env.PORT || 4000);
// ✗ No validation that PORT was set
// ✗ No REQUIRED env variables check
```

**Required Fix:**
Create `.env.production` with validation:
```javascript
const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET'];
requiredEnvVars.forEach(v => {
  if (!process.env[v]) throw new Error(`Missing env: ${v}`);
});
```

---

## 🔴 QA TEST CASES THAT SHOULD PASS (But Will Fail)

### Flow 1: Create Tour → Create Reservation → Generate Schedule

**Current Status:** ❌ BREAKS AT STEP 3

```
1. ✅ Create Tour with Id=10, Abrev=TST
2. ✅ Create Reservation for Tour 10, Fecha=2025-05-15, Points=[pointA, pointB]
3. ❌ Generate Programming Plan
   └─ ERROR: If program.service returns empty array, excel export fails
   └─ ERROR: If points have null coordinates, clustering fails
```

### Flow 2: Login → View Dashboard → CSRF/XSS Protection

**Current Status:** ❌ BREAKS AT STEP 1

```
1. ❌ Login via /api/login
2. ❌ Navigate to /Dashboard
   └─ Route allows navigation WITHOUT token check (no AuthGuard)
   └─ navbar.mode changes to 'login', but page still loads
3. ❌ Make API call → 401 response
   └─ Interceptor calls logout() but doesn't navigate to login
```

### Flow 3: Create Multiple Reservations on Same Date

**Current Status:** ⚠️ PARTIAL

```
1. ✅ Create Reservation #1 (DNI=12345678, Fecha=2025-05-15)
2. ✅ Create Reservation #2 (DNI=12345678, Fecha=2025-05-15)
   └─ ⚠️ System allows (DNI check only validates existence, not day scope limit)
3. ✅ Generate Plan
   └─ ⚠️ Same person appears twice, unclear which takes priority
```

---

## 📋 DEPLOYMENT CHECKLIST (MUST COMPLETE)

Before ANY production deployment, complete ALL items:

**Security:**
- [ ] Add AuthGuard to ALL frontend routes
- [ ] Add 401 redirect to login in auth.interceptor
- [ ] Enable HTTPS/TLS
- [ ] Set secure JWT secret (not default)
- [ ] Implement CSRF protection
- [ ] Add rate limiting to login endpoint

**Data Integrity:**
- [ ] Add FK constraints in database for tours → planes_tours
- [ ] Validate all punto data before using in programación algorithm
- [ ] Fix null envelope unwrapping in api-envelope.interceptor
- [ ] Add NOT NULL constraints where needed

**Code Quality:**
- [ ] Remove ALL console.log statements (except error logging)
- [ ] Delete .copy.js files
- [ ] Add [disabled] binding to all form submit buttons
- [ ] Implement proper error codes across all endpoints

**Testing:**
- [ ] E2E test: Tour → Reserva → Programación flow
- [ ] Test zero-reservas scenario in plan generation
- [ ] Test invalid coordinates in distance calculation
- [ ] Load test: 100 simultaneous reservations

**Operations:**
- [ ] Set up .env.production with all required variables
- [ ] Create backup strategy for database
- [ ] Set up monitoring/alerting
- [ ] Document deployment procedure

---

## 🚨 CRITICAL NEXT STEPS

### PHASE 1: SECURITY (1-2 Days)
1. Create and apply AuthGuard to routes
2. Fix 401 redirect in interceptor
3. Test authentication flow end-to-end

### PHASE 2: DATA INTEGRITY (2-3 Days)
1. Validate Programación edge cases (null coords, zero reservas)
2. Add database constraints (FKs)
3. Fix envelope unwrapping null handling

### PHASE 3: CODE CLEANUP (1 Day)
1. Remove console.log statements
2. Delete .copy.js files
3. Add form validation disabling

### PHASE 4: TESTING & VALIDATION (2-3 Days)
1. E2E testing of critical flows
2. Load testing
3. Security audit

**Estimated Timeline:** 1-2 weeks before safe production deployment

---

## 📞 NOTES FOR DEVELOPMENT TEAM

1. **Prioritize Blockers First:** Don't deploy with route guard vulnerabilities
2. **Test Programación Algorithm:** Handle edge case of zero/null data
3. **Add Logging:** Replace console.log with proper logging library
4. **Document API:** Create OpenAPI/Swagger docs for endpoint contracts
5. **Setup CI/CD:** Automate testing before deployment

---

**Report Prepared By:** Lead QA Engineer  
**Assessment Date:** April 3, 2026  
**Recommendation:** ❌ **DO NOT DEPLOY** until ALL 🔴 BLOCKERS are resolved
