import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Clearing all sponsorship deals, chat messages, and interests...');
  
  // Delete all sponsorship interests (cascades to delete sponsorshipChatMessage and sponsorshipDeal)
  const deletedInterests = await prisma.sponsorshipInterest.deleteMany();
  console.log(`Deleted ${deletedInterests.count} sponsorship interests.`);

  // Delete all general Meetday support chat threads (cascades to messages)
  const deletedMeetdayChats = await prisma.meetdayChatThread.deleteMany();
  console.log(`Deleted ${deletedMeetdayChats.count} Meetday general chat threads.`);

  console.log('Done!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
