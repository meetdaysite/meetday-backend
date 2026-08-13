// Fixed recipient list for admin-facing operational alerts (new signups, pending reviews,
// unexpected errors) — intentionally NOT derived from the admin users table, so it stays
// stable regardless of who holds SUPER_ADMIN/CITY_ADMIN/MODERATOR access.
export const ADMIN_ALERT_EMAILS = ['gagaan@meetday.ai', 'admin@meetday.ai'];

// Error alerts and per-request user-action logs are high-volume/low-signal for most of the
// admin team — these go only to admin@meetday.ai, not the full ADMIN_ALERT_EMAILS list.
export const ADMIN_ERROR_ALERT_EMAILS = ['admin@meetday.ai'];
