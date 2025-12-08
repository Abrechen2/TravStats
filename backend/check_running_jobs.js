const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkRunning() {
    const jobs = await prisma.trainingJob.findMany({
        where: { status: 'running' },
        orderBy: { createdAt: 'desc' }
    });

    if (jobs.length > 0) {
        console.log('✅ Running Job Found:');
        console.log(JSON.stringify(jobs[0], null, 2));
    } else {
        console.log('❌ No running jobs found.');
        const lastJob = await prisma.trainingJob.findFirst({ orderBy: { createdAt: 'desc' } });
        console.log('Last Job:', JSON.stringify(lastJob, null, 2));
    }
}

checkRunning();
