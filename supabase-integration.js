/* ════════════════════════════════════════════════════════════════
 *  ملاعبنا — طبقة الربط مع Supabase (supabase-integration.js)
 *  ────────────────────────────────────────────────────────────────
 *  هذا الملف يربط موقعك الحالي بقاعدة بيانات Supabase الحقيقية.
 *  يحافظ على تركيبة الموقع الأساسية ويضيف الحفظ الدائم.
 *
 *  طريقة الاستخدام:
 *  1) أنشئ مشروع Supabase وركّب ملف malaabna-schema-v2.sql
 *  2) ضع رابط مشروعك ومفتاحك العام في الأسفل
 *  3) أضف هذا السطر في <head> بالموقع:
 *     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *  4) أضف قبل </body>:  <script src="supabase-integration.js"></script>
 * ════════════════════════════════════════════════════════════════ */

// ⚙️ الإعدادات — استبدلها بقيم مشروعك من Supabase → Settings → API
const SUPABASE_URL = 'https://lsgakyydqomzntoebqep.supabase.co';   // رابط مشروعك
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxzZ2FreXlkcW9tem50b2VicWVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMTkwMDEsImV4cCI6MjA5ODU5NTAwMX0.33DmQ23ab5hw3Y3iGtzXphopVMKmnOnTZZfxhtVZmcM';          // المفتاح العام فقط (آمن)

// تهيئة العميل
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


/* ════════════════════════════════════════════════
 *  1. المصادقة (Authentication)
 * ════════════════════════════════════════════════ */

// إنشاء حساب جديد
async function signUp(name, email, phone, password) {
  const { data, error } = await db.auth.signUp({
    email, password,
    options: { data: { name, phone } }   // تُحفظ تلقائياً في profiles عبر Trigger
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, user: data.user };
}

// تسجيل الدخول
async function signIn(email, password) {
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  return { ok: true, user: data.user };
}

// تسجيل الخروج
async function signOut() {
  await db.auth.signOut();
  location.reload();
}

// المستخدم الحالي
async function getCurrentUser() {
  const { data } = await db.auth.getUser();
  if (!data.user) return null;
  // جلب بيانات profile كاملة (الاسم، الدور)
  const { data: profile } = await db
    .from('profiles').select('*').eq('id', data.user.id).single();
  return profile;
}


/* ════════════════════════════════════════════════
 *  2. الملاعب (Facilities & Fields) — مع البحث والفلترة
 * ════════════════════════════════════════════════ */

// جلب كل الملاعب المتاحة مع بيانات المنشأة
async function getFields(filters = {}) {
  let query = db
    .from('fields')
    .select(`
      id, name, type, price_per_hour, status,
      facilities!inner ( id, name, city, district, region, images, latitude, longitude )
    `)
    .eq('status', 'available');

  // الفلترة الجغرافية والسعرية (من مواصفاتك)
  if (filters.city)     query = query.eq('facilities.city', filters.city);
  if (filters.district) query = query.eq('facilities.district', filters.district);
  if (filters.region)   query = query.eq('facilities.region', filters.region);
  if (filters.type)     query = query.eq('type', filters.type);
  if (filters.maxPrice) query = query.lte('price_per_hour', filters.maxPrice);
  if (filters.minPrice) query = query.gte('price_per_hour', filters.minPrice);

  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, fields: data };
}

// البحث بالاسم
async function searchFields(keyword) {
  const { data, error } = await db
    .from('fields')
    .select('*, facilities!inner(*)')
    .ilike('name', `%${keyword}%`);
  if (error) return { ok: false, error: error.message };
  return { ok: true, fields: data };
}


/* ════════════════════════════════════════════════
 *  3. الأوقات المتاحة (Available Slots)
 * ════════════════════════════════════════════════ */

// جلب الأوقات المحجوزة لملعب في يوم محدد
async function getBookedSlots(fieldId, date) {
  const { data, error } = await db
    .from('bookings')
    .select('start_time, end_time')
    .eq('field_id', fieldId)
    .eq('booking_date', date)
    .neq('status', 'cancelled');
  if (error) return { ok: false, error: error.message };
  return { ok: true, booked: data };
}


/* ════════════════════════════════════════════════
 *  4. القطة الذكية (Smart Split) — من مواصفاتك الأصلية
 * ════════════════════════════════════════════════ */

function calculateSmartSplit(totalPrice, playersCount) {
  if (playersCount <= 0) return { error: "يجب تحديد عدد اللاعبين بشكل صحيح" };
  const sharePerPlayer = totalPrice / playersCount;
  const finalShare = Math.round(sharePerPlayer * 100) / 100;
  return {
    totalAmount: totalPrice,
    numberOfPlayers: playersCount,
    sharePerPlayer: finalShare,
    currency: "SAR",
    taxRate: "0% VAT"
  };
}


/* ════════════════════════════════════════════════
 *  5. إنشاء حجز (Create Booking)
 *     ملاحظة: قاعدة البيانات تمنع التعارض تلقائياً
 * ════════════════════════════════════════════════ */

async function createBooking({ fieldId, date, startTime, endTime, playersCount, totalPrice }) {
  const user = (await db.auth.getUser()).data.user;
  if (!user) return { ok: false, error: "يجب تسجيل الدخول أولاً" };

  const { data, error } = await db
    .from('bookings')
    .insert({
      user_id: user.id,
      field_id: fieldId,
      booking_date: date,
      start_time: startTime,
      end_time: endTime,
      players_count: playersCount,
      total_price: totalPrice,
      status: 'pending'   // لا يتأكد إلا بعد الدفع
    })
    .select()
    .single();

  if (error) {
    // ترجمة أخطاء قاعدة البيانات لرسائل واضحة
    if (error.message.includes('BOOKING_OVERLAP'))
      return { ok: false, error: "عذراً، هذا الوقت محجوز. اختر وقتاً آخر." };
    if (error.message.includes('FIELD_UNAVAILABLE'))
      return { ok: false, error: "الملعب مغلق أو تحت الصيانة في هذا الوقت." };
    return { ok: false, error: error.message };
  }
  return { ok: true, booking: data };
}

// حجوزات المستخدم الحالي
async function getMyBookings() {
  const { data, error } = await db
    .from('bookings')
    .select('*, fields(name, facilities(name, city))')
    .order('booking_date', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, bookings: data };
}

// إلغاء حجز
async function cancelBooking(bookingId) {
  const { error } = await db
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}


/* ════════════════════════════════════════════════
 *  6. الكوبونات (Coupons)
 * ════════════════════════════════════════════════ */

async function validateCoupon(code) {
  const { data, error } = await db
    .from('coupons')
    .select('*')
    .eq('code', code)
    .eq('is_active', true)
    .single();
  if (error || !data) return { ok: false, error: "كوبون غير صالح" };
  if (data.expiry_date && new Date(data.expiry_date) < new Date())
    return { ok: false, error: "انتهت صلاحية الكوبون" };
  if (data.usage_limit && data.used_count >= data.usage_limit)
    return { ok: false, error: "انتهى عدد مرات استخدام الكوبون" };
  return { ok: true, coupon: data };
}


/* ════════════════════════════════════════════════
 *  7. التقييمات (Reviews)
 * ════════════════════════════════════════════════ */

async function addReview(fieldId, bookingId, rating, comment) {
  const user = (await db.auth.getUser()).data.user;
  if (!user) return { ok: false, error: "يجب تسجيل الدخول" };
  const { error } = await db
    .from('reviews')
    .insert({ user_id: user.id, field_id: fieldId, booking_id: bookingId, rating, comment });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function getFieldReviews(fieldId) {
  const { data, error } = await db
    .from('reviews')
    .select('rating, comment, created_at, profiles(name)')
    .eq('field_id', fieldId)
    .order('created_at', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, reviews: data };
}


/* ════════════════════════════════════════════════
 *  8. الإشعارات (Notifications)
 * ════════════════════════════════════════════════ */

async function getMyNotifications() {
  const { data, error } = await db
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return { ok: false, error: error.message };
  return { ok: true, notifications: data };
}

async function markNotificationRead(notifId) {
  await db.from('notifications').update({ is_read: true }).eq('id', notifId);
}


/* ════════════════════════════════════════════════
 *  💳 الدفع (Payment) — يُنفّذ عبر Edge Function آمنة
 * ════════════════════════════════════════════════
 *  ملاحظة أمان مهمة:
 *  لا يوجد كود دفع مباشر هنا لأن مفتاح البوابة السري
 *  يجب ألا يكون في الواجهة. الطريقة الصحيحة:
 *
 *  1) أنشئ Supabase Edge Function باسم create-payment
 *  2) ضع مفتاح Moyasar/HyperPay السري في:
 *     Supabase → Edge Functions → Secrets
 *  3) استدعِ الدالة من هنا:
 *
 *  async function initiatePayment(bookingId, amount) {
 *    const { data, error } = await db.functions.invoke('create-payment', {
 *      body: { bookingId, amount }
 *    });
 *    if (error) return { ok: false, error: error.message };
 *    // إعادة توجيه لصفحة الدفع الآمنة
 *    window.location.href = data.paymentUrl;
 *  }
 *
 *  البوابة ترسل Webhook للتأكيد، وEdge Function تحدّث
 *  حالة الحجز إلى confirmed. راجع دليل التشغيل للتفاصيل.
 * ════════════════════════════════════════════════ */


// ════════════════════════════════════════════════
//  تصدير الدوال للاستخدام في الموقع
// ════════════════════════════════════════════════
window.MalaabnaAPI = {
  // المصادقة
  signUp, signIn, signOut, getCurrentUser,
  // الملاعب
  getFields, searchFields, getBookedSlots,
  // الحجز
  calculateSmartSplit, createBooking, getMyBookings, cancelBooking,
  // إضافات
  validateCoupon, addReview, getFieldReviews,
  getMyNotifications, markNotificationRead,
};

console.log('✅ Malaabna API جاهزة. استخدم window.MalaabnaAPI');
