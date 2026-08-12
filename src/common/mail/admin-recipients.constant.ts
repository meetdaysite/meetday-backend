// Fixed recipient list for admin-facing operational alerts (new signups, pending reviews,
// unexpected errors) — intentionally NOT derived from the admin users table, so it stays
// stable regardless of who holds SUPER_ADMIN/CITY_ADMIN/MODERATOR access.
export const ADMIN_ALERT_EMAILS = ['gagaan@meetday.ai', 'admin@meetday.ai'];
