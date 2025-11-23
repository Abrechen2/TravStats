import { prisma } from '../src/db';

async function getUserIds() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (users.length === 0) {
      console.log('❌ No users found in database.');
      console.log('💡 Create a user first by registering on the frontend.');
      process.exit(0);
    }

    console.log('📋 Users in database:\n');
    users.forEach((user, index) => {
      console.log(`${index + 1}. Username: ${user.username}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Created: ${user.createdAt.toISOString()}`);
      console.log('');
    });

    console.log('💡 Copy the ID and add it to .env as IMAP_DEFAULT_USER_ID');
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

getUserIds();
