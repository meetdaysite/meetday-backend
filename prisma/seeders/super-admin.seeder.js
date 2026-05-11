"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedSuperAdmin = seedSuperAdmin;
const admin = require("firebase-admin");
function initFirebase() {
    if (admin.apps.length)
        return;
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey,
        }),
    });
}
async function createOrGetFirebaseUser(email, password, firstName, lastName) {
    try {
        const user = await admin.auth().createUser({
            email,
            password,
            displayName: `${firstName} ${lastName}`,
            emailVerified: true,
        });
        return { user, created: true };
    }
    catch (err) {
        if (err.code === 'auth/email-already-exists') {
            const user = await admin.auth().getUserByEmail(email);
            return { user, created: false };
        }
        throw err;
    }
}
async function seedSuperAdmin(prisma) {
    console.log('\n[Super Admin]');
    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;
    const firstName = process.env.SUPER_ADMIN_FIRST_NAME ?? 'Super';
    const lastName = process.env.SUPER_ADMIN_LAST_NAME ?? 'Admin';
    if (!email || !password) {
        throw new Error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set in .env');
    }
    initFirebase();
    const { user: firebaseUser, created: firebaseCreated } = await createOrGetFirebaseUser(email, password, firstName, lastName);
    console.log(`  Firebase  ${firebaseCreated ? 'CREATED' : 'SKIP   '} ${email} (uid: ${firebaseUser.uid})`);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
    const existingUser = await prisma.user.findUnique({ where: { firebaseUid: firebaseUser.uid } });
    if (existingUser) {
        console.log(`  Database  SKIP    user already exists`);
    }
    else {
        await prisma.user.create({
            data: {
                firebaseUid: firebaseUser.uid,
                email,
                firstName,
                lastName,
                isActive: true,
                roleId: role.id,
            },
        });
        console.log(`  Database  CREATED ${email}`);
    }
    console.log(`  → done`);
}
//# sourceMappingURL=super-admin.seeder.js.map