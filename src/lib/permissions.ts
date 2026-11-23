/** Permission catalogue + default role grants. Keys are `resource:action`. */
export const PERMISSIONS = {
  "org:manage": "Manage organization & settings",
  "subscription:manage": "Manage subscription",
  "user:read": "View users",
  "user:manage": "Invite / suspend / edit users",
  "role:manage": "Manage custom roles",
  "property:read": "View properties",
  "property:manage": "Manage properties",
  "cabana:read": "View cabanas",
  "cabana:manage": "Manage cabanas",
  "pricing:manage": "Manage pricing & promos",
  "booking:read": "View bookings",
  "booking:create": "Create bookings",
  "booking:modify": "Modify / cancel bookings",
  "booking:frontdesk": "Check-in / check-out",
  "guest:read": "View guests",
  "guest:manage": "Manage guests",
  "guest:sensitive": "View guest ID numbers / blacklist",
  "payment:read": "View payments",
  "payment:collect": "Collect payments",
  "payment:refund": "Approve refunds",
  "finance:read": "View finance",
  "finance:manage": "Manage income/expenses",
  "housekeeping:read": "View housekeeping",
  "housekeeping:manage": "Manage cleaning tasks",
  "housekeeping:inspect": "Approve inspections",
  "maintenance:manage": "Manage maintenance",
  "restaurant:read": "View restaurant",
  "restaurant:order": "Take orders",
  "restaurant:manage": "Manage menu & POS",
  "kitchen:manage": "Kitchen display",
  "inventory:read": "View inventory",
  "inventory:manage": "Manage inventory",
  "staff:read": "View staff",
  "staff:manage": "Manage staff",
  "payroll:read": "View salary & payroll",
  "report:read": "View reports",
  "audit:read": "View audit logs",
  "platform:manage": "Super-admin platform management",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const p = (...k: Permission[]) => k;
const notPlatform = ALL_PERMISSIONS.filter((k) => k !== "platform:manage");

export const ROLE_DEFAULTS: Record<string, { name: string; permissions: Permission[] }> = {
  SUPER_ADMIN: { name: "Super Admin", permissions: ALL_PERMISSIONS },
  OWNER: { name: "Owner", permissions: notPlatform },
  GENERAL_MANAGER: {
    name: "General Manager",
    permissions: notPlatform.filter((k) => !["org:manage", "subscription:manage", "role:manage"].includes(k)),
  },
  PROPERTY_ADMIN: {
    name: "Property Admin",
    permissions: notPlatform.filter(
      (k) => !["org:manage", "subscription:manage", "role:manage", "payroll:read", "user:manage"].includes(k),
    ),
  },
  RECEPTIONIST: {
    name: "Receptionist",
    permissions: p("property:read", "cabana:read", "booking:read", "booking:create", "booking:modify", "booking:frontdesk", "guest:read", "guest:manage", "payment:read", "payment:collect", "restaurant:read"),
  },
  ACCOUNTANT: {
    name: "Accountant",
    permissions: p("property:read", "booking:read", "payment:read", "payment:collect", "payment:refund", "finance:read", "finance:manage", "report:read", "payroll:read", "inventory:read"),
  },
  HOUSEKEEPING: { name: "Housekeeping", permissions: p("cabana:read", "housekeeping:read", "housekeeping:manage", "housekeeping:inspect") },
  RESTAURANT_MANAGER: { name: "Restaurant Manager", permissions: p("property:read", "booking:read", "restaurant:read", "restaurant:order", "restaurant:manage", "kitchen:manage", "inventory:read", "report:read") },
  WAITER: { name: "Waiter", permissions: p("booking:read", "restaurant:read", "restaurant:order") },
  KITCHEN_STAFF: { name: "Kitchen Staff", permissions: p("restaurant:read", "kitchen:manage") },
  STORE_KEEPER: { name: "Store Keeper", permissions: p("inventory:read", "inventory:manage") },
  MAINTENANCE: { name: "Maintenance", permissions: p("cabana:read", "maintenance:manage") },
  CUSTOMER: { name: "Customer", permissions: [] },
};

/** Roles that see every property in their organization without explicit assignment. */
export const ORG_WIDE_ROLES = new Set(["OWNER", "GENERAL_MANAGER"]);

