/* ============================================================
   firebase-config.js  — v2 (Auth + Activity Logs)
   ============================================================ */

// ── YOUR FIREBASE CONFIG — REPLACE WITH YOUR VALUES ──
const firebaseConfig = {
  apiKey: "AIzaSyCJKcUJ7eZtioWcLmRsRfwyFMhgt1y8WEs",
  authDomain: "indoor-hospital-navigation.firebaseapp.com",
  projectId: "indoor-hospital-navigation",
  storageBucket: "indoor-hospital-navigation.firebasestorage.app",
  messagingSenderId: "51450486856",
  appId: "1:51450486856:web:240a5e9072f79096a5b87d",
  measurementId: "G-MZF3HKV8GL"
};

firebase.initializeApp(firebaseConfig);
const db   = firebase.firestore();
const auth = firebase.auth();

/* ── AUTH ── */
async function loginWithEmail(email, password) {
  const cred = await auth.signInWithEmailAndPassword(email, password);
  const user = cred.user;
  const profileDoc = await db.collection('staff').doc(user.uid).get();
  const profile = profileDoc.exists ? profileDoc.data() : { name: user.email, role: 'staff' };
  await logActivity({ type:'login', staffId:user.uid, staffName:profile.name, staffEmail:user.email, role:profile.role });
  sessionStorage.setItem('staffLogin', JSON.stringify({ uid:user.uid, email:user.email, name:profile.name, role:profile.role }));
  return { user, profile };
}

async function logoutStaff() {
  const staff = getLoggedInStaff();
  if (staff) await logActivity({ type:'logout', staffId:staff.uid, staffName:staff.name, staffEmail:staff.email, role:staff.role });
  sessionStorage.removeItem('staffLogin');
  await auth.signOut();
}

function getLoggedInStaff() {
  const raw = sessionStorage.getItem('staffLogin');
  return raw ? JSON.parse(raw) : null;
}

function requireLogin() {
  if (!getLoggedInStaff()) { alert('Please login as staff first.'); window.location.href = 'login.html'; }
}

function requireAdmin() {
  const staff = getLoggedInStaff();
  if (!staff || staff.role !== 'admin') { alert('Access denied. Admin only.'); window.location.href = 'index.html'; }
}

function loginStaff(id, name) { /* legacy compat */ }

/* ── ACTIVITY LOG ── */
async function logActivity(data) {
  try {
    await db.collection('activityLogs').add({
      ...data,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      timestampISO: new Date().toISOString(),
    });
  } catch(e) { console.warn('Log failed:', e.message); }
}

async function getActivityLogs(limitN = 100) {
  const snap = await db.collection('activityLogs').orderBy('timestamp','desc').limit(limitN).get();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}

/* ── PATIENTS ── */
const SAMPLE_PATIENTS = [
  { id:'P001', name:'Ram Kumar',    room:'101', floor:1, dept:'General Ward',   notes:'Window bed' },
  { id:'P002', name:'Sita Devi',    room:'202', floor:2, dept:'Cardiology',     notes:'Post-op care' },
  { id:'P003', name:'Ravi Teja',    room:'ICU', floor:1, dept:'ICU',            notes:'Critical' },
  { id:'P004', name:'Anita Rao',    room:'115', floor:1, dept:'Orthopaedics',   notes:'Leg fracture' },
  { id:'P005', name:'Kumar Reddy',  room:'305', floor:3, dept:'Neurology',      notes:'Follow-up' },
  { id:'P006', name:'Priya Sharma', room:'210', floor:2, dept:'Maternity Ward', notes:'Delivery ward' },
];

async function seedSampleData() {
  try {
    const snap = await db.collection('patients').limit(1).get();
    if (snap.empty) {
      const batch = db.batch();
      SAMPLE_PATIENTS.forEach(p => {
        batch.set(db.collection('patients').doc(p.id), { ...p, addedBy:'System', addedByEmail:'system@hospital.com', addedAt:firebase.firestore.FieldValue.serverTimestamp(), addedAtISO:new Date().toISOString() });
      });
      await batch.commit();
    }
  } catch(e) { console.warn('Seed failed:', e.message); }
}

async function getPatients() {
  try {
    const snap = await db.collection('patients').orderBy('name').get();
    return snap.docs.map(d => d.data());
  } catch(e) { return []; }
}

async function savePatient(patient) {
  const staff = getLoggedInStaff();
  const now   = new Date();
  await db.collection('patients').doc(patient.id).set({
    ...patient,
    addedBy:      staff ? staff.name  : 'Unknown',
    addedByEmail: staff ? staff.email : 'unknown',
    addedAt:      firebase.firestore.FieldValue.serverTimestamp(),
    addedAtISO:   now.toISOString(),
  });
  await logActivity({ type:'add_patient', staffId:staff?.uid||'?', staffName:staff?.name||'Unknown', staffEmail:staff?.email||'?', patientId:patient.id, patientName:patient.name, room:patient.room, floor:patient.floor, dept:patient.dept });
}

async function deletePatientById(patientId, patientName) {
  const staff = getLoggedInStaff();
  await db.collection('patients').doc(patientId).delete();
  await logActivity({ type:'delete_patient', staffId:staff?.uid||'?', staffName:staff?.name||'Unknown', staffEmail:staff?.email||'?', patientId, patientName:patientName||patientId });
}

async function checkPatientIdExists(id) {
  const doc = await db.collection('patients').doc(id).get();
  return doc.exists;
}

async function findPatient(query) {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  const all = await getPatients();
  return all.find(p => p.name.toLowerCase().includes(q) || p.id.toLowerCase() === q) || null;
}

/* ── STAFF MANAGEMENT ── */
async function createStaffAccount(email, password, name, role='staff') {
  const cred = await auth.createUserWithEmailAndPassword(email, password);
  const uid  = cred.user.uid;
  const admin = getLoggedInStaff();
  await db.collection('staff').doc(uid).set({ uid, email, name, role, createdAt:firebase.firestore.FieldValue.serverTimestamp(), createdAtISO:new Date().toISOString(), createdBy:admin?.name||'System' });
  await logActivity({ type:'create_account', staffId:admin?.uid||'system', staffName:admin?.name||'System', newStaffEmail:email, newStaffName:name, newStaffRole:role });
  return uid;
}

async function getAllStaff() {
  const snap = await db.collection('staff').orderBy('name').get();
  return snap.docs.map(d => d.data());
}

async function deleteStaffProfile(uid) {
  await db.collection('staff').doc(uid).delete();
}

/* ── FORMAT TIMESTAMP ── */
function formatTimestamp(ts) {
  if (!ts) return '—';
  let date;
  if (ts.toDate) date = ts.toDate();
  else if (typeof ts === 'string') date = new Date(ts);
  else date = new Date(ts);
  return date.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true });
}
