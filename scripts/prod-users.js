const { PrismaClient } = require('./backend/node_modules/@prisma/client');
const p = new PrismaClient();
p.user.findMany({ select: { id: true, username: true } })
  .then(u => { console.log(JSON.stringify(u)); p.$disconnect(); })
  .catch(e => { console.error(e.message); p.$disconnect(); });
