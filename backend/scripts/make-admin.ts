
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const username = process.argv[2];
    if (!username) {
        console.error('Please provide a username');
        process.exit(1);
    }

    const user = await prisma.user.update({
        where: { username },
        data: { isAdmin: true },
    });

    console.log(`User ${user.username} is now an admin!`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
