const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function showLogs() {
    const job = await prisma.trainingJob.findFirst({
        orderBy: { createdAt: 'desc' },
        include: { logs: true }
    });

    if (job) {
        console.log('Job Status:', job.status);
        console.log('Error Message:', job.errorMessage);
        console.log('Logs:', JSON.stringify(job.logs, null, 2));
    }
}

showLogs();
