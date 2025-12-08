const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cancelJob() {
    const jobId = '70c7f0c4-cee7-448a-93fa-2dacd3e00150';

    try {
        const job = await prisma.trainingJob.update({
            where: { id: jobId },
            data: {
                status: 'cancelled',
                completedAt: new Date(),
                errorMessage: 'Training cancelled manually via script',
            },
        });

        console.log('✅ Training job cancelled successfully!');
        console.log('Job ID:', job.id);
        console.log('Status:', job.status);
    } catch (error) {
        console.error('❌ Error cancelling job:', error.message);
    } finally {
        await prisma.$disconnect();
    }
}

cancelJob();
