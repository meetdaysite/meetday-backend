import { PrismaClient, MediaType } from '@prisma/client';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

const SEED_IMAGES_DIR = path.join(__dirname, '..', 'seed-images');
const S3_SEED_PREFIX = 'seed/events';

const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

interface EventSeed {
  title: string;
  description: string;
  category: string;
  city: string;
  venueName: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  eventDate: Date;
  startTime: string;
  endTime: string;
  isFree: boolean;
  ticketName?: string;
  ticketPrice?: number;
  capacity?: number;
  tags: string[];
  languages: string[];
  whatToExpect: string[];
  whoShouldAttend: string[];
  imageFile: string;
}

const future = (days: number): Date => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d;
};

const EVENTS: EventSeed[] = [
  {
    title: 'Bangalore Angel Investor Mixer',
    description:
      'A curated evening for angels and early-stage founders to connect, explore deal flow, and build meaningful relationships in the Bangalore startup ecosystem.',
    category: 'Investor Meetups',
    city: 'Bangalore',
    venueName: 'Taj MG Road',
    fullAddress: '41/3, Mahatma Gandhi Rd, Halasuru, Bengaluru, Karnataka 560001',
    latitude: 12.9716,
    longitude: 77.6099,
    eventDate: future(16),
    startTime: '06:30 PM',
    endTime: '09:30 PM',
    isFree: false,
    ticketName: 'General Admission',
    ticketPrice: 1500,
    capacity: 80,
    tags: ['investing', 'startups', 'networking', 'angels'],
    languages: ['English'],
    whatToExpect: ['Structured networking rounds', 'Lightning pitches from 3 founders', 'Open bar and canapés'],
    whoShouldAttend: ['Angel investors', 'Seed-stage founders', 'VCs exploring early deals'],
    imageFile: 'investor-meetup-bangalore.png',
  },
  {
    title: 'Mumbai Venture Capital Connect',
    description:
      "Mumbai's premier VC networking event — bringing together fund managers, LPs, and portfolio companies for an evening of candid conversations and deal exploration.",
    category: 'Investor Meetups',
    city: 'Mumbai',
    venueName: 'Four Seasons Hotel Mumbai',
    fullAddress: '114, Dr E Moses Rd, Worli, Mumbai, Maharashtra 400018',
    latitude: 19.0178,
    longitude: 72.8178,
    eventDate: future(22),
    startTime: '07:00 PM',
    endTime: '10:00 PM',
    isFree: false,
    ticketName: 'Member Pass',
    ticketPrice: 2500,
    capacity: 60,
    tags: ['VC', 'venture capital', 'startups', 'fundraising'],
    languages: ['English'],
    whatToExpect: ['Fireside chat with a top VC', 'Curated networking with badge scanning', 'Cocktails and dinner'],
    whoShouldAttend: ['VCs and fund managers', 'Series A+ founders', 'Corporate venture arms'],
    imageFile: 'investor-meetup-mumbai.png',
  },
  {
    title: 'Bangalore Demo Day — Summer Cohort 2026',
    description:
      'Watch 8 early-stage startups pitch their products live to a room full of investors, mentors, and ecosystem builders. Audience votes decide the crowd favourite.',
    category: 'Demo Days',
    city: 'Bangalore',
    venueName: 'NASSCOM 10000 Startups Hub',
    fullAddress: '6th Floor, Salarpuria Touchstone, Outer Ring Rd, Bangalore 560103',
    latitude: 12.9351,
    longitude: 77.6935,
    eventDate: future(30),
    startTime: '10:00 AM',
    endTime: '02:00 PM',
    isFree: true,
    tags: ['demo day', 'startups', 'pitching', 'investors'],
    languages: ['English'],
    whatToExpect: ['8 startup pitches (5 min each)', 'Q&A with investor panel', 'Lunch and networking after'],
    whoShouldAttend: ['Investors', 'Startup founders', 'Ecosystem builders', 'Students interested in startups'],
    imageFile: 'demo-day-bangalore.png',
  },
  {
    title: 'HackBLR — 24-Hour AI Hackathon',
    description:
      'Build something remarkable in 24 hours. Teams of 2–4 tackle AI-first problem statements across healthtech, fintech, and climate. Prizes worth ₹5L.',
    category: 'Hackathons',
    city: 'Bangalore',
    venueName: 'Microsoft Reactor Bangalore',
    fullAddress: 'WeWork Galaxy, 43 Residency Rd, Bengaluru, Karnataka 560025',
    latitude: 12.9715,
    longitude: 77.6099,
    eventDate: future(20),
    startTime: '09:00 AM',
    endTime: '09:00 AM',
    isFree: false,
    ticketName: 'Team Registration (per person)',
    ticketPrice: 500,
    capacity: 200,
    tags: ['hackathon', 'AI', 'coding', 'tech', 'prizes'],
    languages: ['English'],
    whatToExpect: [
      'Problem statement reveal at 9 AM',
      'Mentoring sessions every 4 hours',
      'Demos + judging at Hour 22',
      'Prizes + swag for top 3 teams',
    ],
    whoShouldAttend: ['Developers', 'Designers', 'Product managers', 'AI/ML enthusiasts'],
    imageFile: 'hackathon-bangalore.png',
  },
  {
    title: 'HackHyd 2026 — Fintech Edition',
    description:
      "Hyderabad's biggest fintech hackathon. 48 hours to build the next breakthrough in payments, lending, or insurance. Supported by leading banks and fintech VCs.",
    category: 'Hackathons',
    city: 'Hyderabad',
    venueName: 'T-Hub Phase 2',
    fullAddress: 'Raidurgam, Knowledge City Rd, Hyderabad, Telangana 500081',
    latitude: 17.4399,
    longitude: 78.3489,
    eventDate: future(35),
    startTime: '10:00 AM',
    endTime: '10:00 AM',
    isFree: false,
    ticketName: 'Hacker Pass',
    ticketPrice: 299,
    capacity: 300,
    tags: ['hackathon', 'fintech', 'payments', 'banking', 'tech'],
    languages: ['English', 'Telugu', 'Hindi'],
    whatToExpect: ['48-hour build sprint', 'Bank API sandboxes provided', 'Expert mentors on call', '₹3L in prizes'],
    whoShouldAttend: ['Engineers', 'Finance professionals', 'Students', 'Product builders'],
    imageFile: 'hackathon-hyderabad.png',
  },
  {
    title: 'No-Code Product Building Workshop — Pune',
    description:
      'A hands-on 3-hour workshop teaching you to ship a real product using no-code tools — Bubble, Webflow, and Airtable. Walk in with an idea, walk out with a working prototype.',
    category: 'Workshops',
    city: 'Pune',
    venueName: 'CoWork Café Pune',
    fullAddress: '4th Floor, Amar Avinash Corporate City, Baner, Pune 411045',
    latitude: 18.559,
    longitude: 73.7868,
    eventDate: future(18),
    startTime: '11:00 AM',
    endTime: '02:00 PM',
    isFree: false,
    ticketName: 'Workshop Seat',
    ticketPrice: 799,
    capacity: 25,
    tags: ['no-code', 'product', 'workshop', 'Bubble', 'Webflow'],
    languages: ['English', 'Hindi'],
    whatToExpect: [
      'Structured curriculum across 3 tools',
      'Live build sessions',
      'Templates to take home',
      'Post-workshop community access',
    ],
    whoShouldAttend: ['Aspiring founders', 'Product managers', 'Designers who want to build', 'Non-technical entrepreneurs'],
    imageFile: 'workshop-pune.png',
  },
  {
    title: 'Public Speaking Masterclass — Delhi',
    description:
      'Overcome stage fear and become a compelling communicator. Practical drills, instant feedback, and personalised coaching in a safe, small-group setting.',
    category: 'Workshops',
    city: 'Delhi',
    venueName: 'The Piano Man Jazz Club',
    fullAddress: 'B6-7/12, Safdarjung Enclave, New Delhi 110029',
    latitude: 28.5677,
    longitude: 77.209,
    eventDate: future(26),
    startTime: '10:30 AM',
    endTime: '01:30 PM',
    isFree: false,
    ticketName: 'Workshop Pass',
    ticketPrice: 999,
    capacity: 20,
    tags: ['public speaking', 'communication', 'confidence', 'workshop'],
    languages: ['English', 'Hindi'],
    whatToExpect: [
      'Ice-breaker speaking rounds',
      'Video playback analysis',
      '1-on-1 feedback from coach',
      'Breathing and posture drills',
    ],
    whoShouldAttend: [
      'Professionals preparing for presentations',
      'Founders preparing to pitch',
      'Students',
      'Anyone nervous on stage',
    ],
    imageFile: 'workshop-delhi.png',
  },
  {
    title: 'Personal Finance Masterclass with CA Meera Shah',
    description:
      "Everything they didn't teach you about money — mutual funds, tax-saving strategies, and building a portfolio from scratch. Led by Chartered Accountant Meera Shah.",
    category: 'Masterclasses',
    city: 'Mumbai',
    venueName: 'WeWork BKC',
    fullAddress: 'Platina, G Block, Bandra Kurla Complex, Mumbai 400051',
    latitude: 19.066,
    longitude: 72.868,
    eventDate: future(14),
    startTime: '07:00 PM',
    endTime: '09:00 PM',
    isFree: false,
    ticketName: 'Masterclass Seat',
    ticketPrice: 1299,
    capacity: 40,
    tags: ['finance', 'investing', 'tax', 'masterclass', 'money'],
    languages: ['English', 'Hindi'],
    whatToExpect: ['90-min structured session', 'Real portfolio examples', 'Live Q&A', 'Resource pack on WhatsApp'],
    whoShouldAttend: ['Young professionals', 'Salaried employees', 'Freelancers', 'Anyone wanting to start investing'],
    imageFile: 'masterclass-mumbai.png',
  },
  {
    title: 'UX Research Masterclass — Chennai',
    description:
      'A deep-dive into modern UX research methods — from user interviews to usability testing. Taught by a designer with 10+ years at product-led companies.',
    category: 'Masterclasses',
    city: 'Chennai',
    venueName: 'IITM Research Park',
    fullAddress: 'Kanagam Rd, Taramani, Chennai, Tamil Nadu 600113',
    latitude: 12.9923,
    longitude: 80.2428,
    eventDate: future(40),
    startTime: '10:00 AM',
    endTime: '01:00 PM',
    isFree: false,
    ticketName: 'Masterclass Pass',
    ticketPrice: 1499,
    capacity: 30,
    tags: ['UX', 'design', 'research', 'product design', 'masterclass'],
    languages: ['English', 'Tamil'],
    whatToExpect: [
      'Research frameworks overview',
      'Live user interview demo',
      'Affinity mapping exercise',
      'Portfolio-worthy case study template',
    ],
    whoShouldAttend: ['UX designers', 'Product managers', 'Researchers', 'Design students'],
    imageFile: 'masterclass-chennai.png',
  },
  {
    title: "Founders' Breakfast Bangalore",
    description:
      'A light, focused 90-minute breakfast for founders to share wins, challenges, and connect with peers — before the workday begins. No pitching, just real conversations.',
    category: 'Breakfast Meetups',
    city: 'Bangalore',
    venueName: 'Café Coffee Day Square, Vittal Mallya Road',
    fullAddress: '1, Vittal Mallya Rd, Shanthala Nagar, Bangalore 560001',
    latitude: 12.9716,
    longitude: 77.5946,
    eventDate: future(15),
    startTime: '08:00 AM',
    endTime: '09:30 AM',
    isFree: true,
    tags: ['founders', 'breakfast', 'networking', 'startup'],
    languages: ['English'],
    whatToExpect: [
      'Curated seating arrangement',
      'One conversation prompt per table',
      'Breakfast buffet included',
      'WhatsApp group for follow-ups',
    ],
    whoShouldAttend: ['Early-stage founders', 'Solo entrepreneurs', 'Co-founders looking for community'],
    imageFile: 'breakfast-meetup-bangalore.png',
  },
  {
    title: 'Mumbai Creative Community Mixer',
    description:
      "A casual evening for Mumbai's creative community — designers, filmmakers, illustrators, and writers — to mix, mingle, and find collaborators over drinks.",
    category: 'Community Mixers',
    city: 'Mumbai',
    venueName: 'Blue Tokai Coffee, Lower Parel',
    fullAddress: '41, Mathuradas Mill Compound, Lower Parel, Mumbai 400013',
    latitude: 19.0106,
    longitude: 72.8271,
    eventDate: future(24),
    startTime: '07:00 PM',
    endTime: '10:00 PM',
    isFree: true,
    tags: ['creative', 'design', 'community', 'networking', 'mixer'],
    languages: ['English', 'Hindi'],
    whatToExpect: [
      'Icebreaker card game',
      'Open studio corner for quick portfolio shares',
      'DJ set from 8 PM',
      'Free entry, pay for drinks',
    ],
    whoShouldAttend: ['Designers', 'Illustrators', 'Writers', 'Filmmakers', 'Creative directors'],
    imageFile: 'community-mixer-mumbai.png',
  },
  {
    title: 'Indiranagar Tech & Beer Mixer',
    description:
      'The most relaxed tech mixer in Bangalore — engineers, PMs, and designers getting together over cold beer and good conversation in Indiranagar.',
    category: 'Community Mixers',
    city: 'Bangalore',
    venueName: 'Toit Brewpub',
    fullAddress: '298, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038',
    latitude: 12.9784,
    longitude: 77.6408,
    eventDate: future(28),
    startTime: '06:30 PM',
    endTime: '09:30 PM',
    isFree: true,
    tags: ['tech', 'beer', 'networking', 'engineers', 'community'],
    languages: ['English'],
    whatToExpect: [
      'Free-flowing networking',
      'Speed introductions to kick things off',
      'Tab-your-own drinks',
      'A lightning talk slot open to attendees',
    ],
    whoShouldAttend: ['Software engineers', 'Product managers', 'Designers', 'Tech enthusiasts'],
    imageFile: 'community-mixer-bangalore.png',
  },
  {
    title: 'Goa Yoga & Mindfulness Retreat',
    description:
      'A weekend immersion in Goa combining beach yoga, breathwork, sound healing, and guided meditation. Unplug, restore, and reconnect with yourself.',
    category: 'Wellness Retreat',
    city: 'Goa',
    venueName: 'Shreyas Retreat Goa',
    fullAddress: 'Assagao, Bardez, North Goa 403507',
    latitude: 15.5885,
    longitude: 73.7674,
    eventDate: future(45),
    startTime: '06:30 AM',
    endTime: '07:00 PM',
    isFree: false,
    ticketName: 'Full Weekend Pass',
    ticketPrice: 8500,
    capacity: 30,
    tags: ['yoga', 'mindfulness', 'retreat', 'wellness', 'Goa', 'meditation'],
    languages: ['English'],
    whatToExpect: [
      'Sunrise yoga on the beach',
      'Breathwork session',
      'Sound healing bowl experience',
      'Vegetarian meals included',
      'Journaling workshop',
    ],
    whoShouldAttend: ['Professionals seeking a reset', 'Yoga practitioners at any level', 'Anyone dealing with burnout', 'Solo travellers'],
    imageFile: 'wellness-retreat-goa.png',
  },
  {
    title: 'Rishikesh Himalayan Detox Retreat',
    description:
      'Disconnect from screens and reconnect with nature. A 2-day wellness retreat in Rishikesh featuring Himalayan yoga, river meditation, and Ayurvedic meals.',
    category: 'Wellness Retreat',
    city: 'Rishikesh',
    venueName: 'Parmarth Niketan Ashram',
    fullAddress: 'Swarg Ashram, Rishikesh, Uttarakhand 249304',
    latitude: 30.1125,
    longitude: 78.3219,
    eventDate: future(50),
    startTime: '07:00 AM',
    endTime: '06:00 PM',
    isFree: false,
    ticketName: 'Retreat Pass (per person)',
    ticketPrice: 6500,
    capacity: 20,
    tags: ['Rishikesh', 'Himalayas', 'yoga', 'detox', 'wellness', 'Ayurveda'],
    languages: ['English', 'Hindi'],
    whatToExpect: [
      'Riverside Ganga Aarti attendance',
      'Himalayan yoga sessions',
      'Ayurvedic diet and meals',
      'Silent nature walk',
      'Group sharing circle',
    ],
    whoShouldAttend: ['Wellness seekers', 'Yoga lovers', 'Professionals on burnout', 'Spiritual explorers'],
    imageFile: 'wellness-retreat-rishikesh.png',
  },
  {
    title: 'Nandi Hills Dawn Trek — Bangalore',
    description:
      'Catch the legendary sunrise from the top of Nandi Hills. A guided group trek leaving at 4 AM, reaching the summit just as the sun rises above the clouds.',
    category: 'Outdoor Activities',
    city: 'Bangalore',
    venueName: 'Nandi Hills',
    fullAddress: 'Nandi Hills, Chikkaballapur District, Karnataka 562103',
    latitude: 13.3702,
    longitude: 77.6835,
    eventDate: future(19),
    startTime: '04:00 AM',
    endTime: '09:00 AM',
    isFree: false,
    ticketName: 'Trek Pass',
    ticketPrice: 599,
    capacity: 40,
    tags: ['trekking', 'sunrise', 'Nandi Hills', 'outdoor', 'nature'],
    languages: ['English', 'Kannada'],
    whatToExpect: ['Guided group trek to the summit', 'Sunrise photography time', 'Hot chai at the top', 'Safe return by 9 AM'],
    whoShouldAttend: ['Nature lovers', 'Photography enthusiasts', 'Fitness-minded folks', "Anyone who hasn't seen a Nandi sunrise"],
    imageFile: 'outdoor-bangalore.png',
  },
  {
    title: 'Sinhagad Fort Cycling Expedition — Pune',
    description:
      'An epic group cycling ride from Pune city to the historic Sinhagad Fort. 35 km of scenic roads, a fort summit visit, and post-ride chai on us.',
    category: 'Outdoor Activities',
    city: 'Pune',
    venueName: 'Sinhagad Fort',
    fullAddress: 'Sinhagad Fort, Pune, Maharashtra 411025',
    latitude: 18.366,
    longitude: 73.7553,
    eventDate: future(33),
    startTime: '06:00 AM',
    endTime: '12:00 PM',
    isFree: false,
    ticketName: 'Cycling Pass',
    ticketPrice: 449,
    capacity: 30,
    tags: ['cycling', 'Sinhagad', 'outdoor', 'fort', 'adventure'],
    languages: ['English', 'Marathi'],
    whatToExpect: ['35 km guided group ride', 'Historical tour of the fort', 'Chai and local breakfast stop', 'Sweep vehicle for emergencies'],
    whoShouldAttend: ['Cycling enthusiasts', 'History buffs', 'Outdoor adventurers', 'Fitness groups'],
    imageFile: 'outdoor-pune.png',
  },
  {
    title: 'Old World Wine Tasting — Mumbai',
    description:
      'A guided tasting of 6 Old World wines — French, Italian, and Spanish — led by a certified sommelier. Learn to read labels, identify aromas, and pair like a pro.',
    category: 'Wine / Food Tasting',
    city: 'Mumbai',
    venueName: 'The Bombay Canteen',
    fullAddress: 'Process House, Kamala Mills, Lower Parel, Mumbai 400013',
    latitude: 19.0067,
    longitude: 72.8299,
    eventDate: future(21),
    startTime: '07:30 PM',
    endTime: '10:00 PM',
    isFree: false,
    ticketName: 'Tasting Pass',
    ticketPrice: 2200,
    capacity: 24,
    tags: ['wine', 'tasting', 'sommelier', 'French wine', 'Italian wine'],
    languages: ['English'],
    whatToExpect: ['6 curated wine pours', 'Guided tasting notes', 'Food pairing bites', 'Sommelier Q&A', 'Take-home guide sheet'],
    whoShouldAttend: ['Wine-curious beginners', 'Enthusiasts looking to level up', 'Couples', 'Corporate groups'],
    imageFile: 'wine-tasting-mumbai.png',
  },
  {
    title: 'Delhi Street Food Safari',
    description:
      "A curated evening walk through Old Delhi's legendary food lanes — tasting 8 iconic dishes across 4 stops, guided by a food historian who knows every alley.",
    category: 'Wine / Food Tasting',
    city: 'Delhi',
    venueName: 'Chandni Chowk, Old Delhi',
    fullAddress: 'Chandni Chowk, Shahjahanabad, New Delhi 110006',
    latitude: 28.6562,
    longitude: 77.2312,
    eventDate: future(38),
    startTime: '06:30 PM',
    endTime: '09:30 PM',
    isFree: false,
    ticketName: 'Food Safari Pass',
    ticketPrice: 899,
    capacity: 20,
    tags: ['street food', 'Delhi food', 'Old Delhi', 'food tour', 'Chandni Chowk'],
    languages: ['English', 'Hindi'],
    whatToExpect: ['8 food tastings across 4 stops', 'History of Old Delhi cuisine', 'Guided walk through Chandni Chowk lanes', 'Digestif chai to end'],
    whoShouldAttend: ['Food lovers', 'Travellers visiting Delhi', 'Foodies', 'History enthusiasts'],
    imageFile: 'wine-tasting-delhi.png',
  },
  {
    title: 'Bangalore Rooftop Sundowner',
    description:
      "An elevated evening soirée on one of Bangalore's best rooftops. Craft cocktails, a live DJ, breathtaking views, and a crowd that knows how to end a Friday right.",
    category: 'Sundowner',
    city: 'Bangalore',
    venueName: 'High Ultra Lounge',
    fullAddress: '31st Floor, World Trade Center, Brigade Gateway, Malleswaram, Bengaluru 560055',
    latitude: 13.0076,
    longitude: 77.5547,
    eventDate: future(17),
    startTime: '05:30 PM',
    endTime: '09:30 PM',
    isFree: false,
    ticketName: 'Entry + Welcome Drink',
    ticketPrice: 1200,
    capacity: 100,
    tags: ['rooftop', 'sundowner', 'cocktails', 'DJ', 'Friday night'],
    languages: ['English'],
    whatToExpect: ['Unobstructed 360° city views', 'Welcome cocktail on arrival', 'Live DJ set from 6:30 PM', 'Small plates and snacks available'],
    whoShouldAttend: ['Working professionals', 'Couples', 'Social butterflies', 'Anyone who loves a great view'],
    imageFile: 'sundowner-bangalore.png',
  },
  {
    title: 'Goa Beach Sundowner Party',
    description:
      'Watch the Arabian Sea turn gold at this legendary Goa beach sundowner. Beanbag seating, acoustic sets, local cocktails, and sunsets that will stay with you forever.',
    category: 'Sundowner',
    city: 'Goa',
    venueName: 'Sunset Beach Shack, Arambol',
    fullAddress: 'Arambol Beach, Pernem, North Goa 403524',
    latitude: 15.6866,
    longitude: 73.704,
    eventDate: future(43),
    startTime: '04:30 PM',
    endTime: '08:00 PM',
    isFree: false,
    ticketName: 'Sundowner Pass',
    ticketPrice: 699,
    capacity: 60,
    tags: ['Goa', 'beach', 'sundowner', 'sunset', 'music'],
    languages: ['English', 'Hindi'],
    whatToExpect: ['Beachfront seating', 'Acoustic live set at 5 PM', 'Classic Goa cocktail menu', 'Bonfire and snacks as it gets dark'],
    whoShouldAttend: ['Travellers in Goa', 'Beach lovers', 'Music fans', 'Couples and groups'],
    imageFile: 'sundowner-goa.png',
  },
  {
    title: 'Hyderabad Indie Music Fest',
    description:
      "A two-act indie concert featuring Hyderabad's most exciting emerging artists. Raw talent, intimate venue, and music that actually means something.",
    category: 'Musical Concerts',
    city: 'Hyderabad',
    venueName: 'Lamakaan Cultural Hub',
    fullAddress: '106, Road No. 1, Banjara Hills, Hyderabad 500034',
    latitude: 17.4117,
    longitude: 78.4487,
    eventDate: future(27),
    startTime: '07:00 PM',
    endTime: '10:30 PM',
    isFree: false,
    ticketName: 'Concert Pass',
    ticketPrice: 499,
    capacity: 120,
    tags: ['indie music', 'live concert', 'Hyderabad music', 'emerging artists'],
    languages: ['English', 'Telugu', 'Hindi'],
    whatToExpect: ['2 headline acts, 1 opening act', 'Intimate 120-seat venue', 'Bar and snacks available', 'Artist meet-and-greet after show'],
    whoShouldAttend: ['Music lovers', 'Indie music fans', 'Anyone tired of mainstream shows', 'Local music supporters'],
    imageFile: 'concert-hyderabad.png',
  },
  {
    title: 'Mumbai Jazz Night — The Jiving Queens',
    description:
      "A live jazz performance by The Jiving Queens — Mumbai's beloved all-women jazz quartet. An evening of soul, swing, and bossa nova in an intimate club setting.",
    category: 'Musical Concerts',
    city: 'Mumbai',
    venueName: 'Blue Frog',
    fullAddress: 'Mathuradas Mill Compound, Lower Parel, Mumbai 400013',
    latitude: 19.0122,
    longitude: 72.8266,
    eventDate: future(36),
    startTime: '08:00 PM',
    endTime: '11:00 PM',
    isFree: false,
    ticketName: 'Table Seat',
    ticketPrice: 999,
    capacity: 80,
    tags: ['jazz', 'live music', 'concert', 'Mumbai nightlife', 'women artists'],
    languages: ['English'],
    whatToExpect: ['90-min live jazz set', 'Encore Q&A with band members', 'Cocktail bar open all evening', 'Dinner reservations available separately'],
    whoShouldAttend: ['Jazz enthusiasts', 'Music lovers', 'Date night couples', 'Culture seekers'],
    imageFile: 'concert-mumbai.png',
  },
  {
    title: 'Bangalore Open Mic — Stand Up Night',
    description:
      "Bangalore's most popular open mic night. 10 comedians, 45 minutes of sharp original material, and an audience that appreciates a well-crafted punchline.",
    category: 'Standup Comedy',
    city: 'Bangalore',
    venueName: 'Canvas Laugh Club Bangalore',
    fullAddress: '2nd Floor, UB City, Vittal Mallya Rd, Bengaluru 560001',
    latitude: 12.972,
    longitude: 77.5962,
    eventDate: future(23),
    startTime: '08:00 PM',
    endTime: '10:00 PM',
    isFree: false,
    ticketName: 'Comedy Pass',
    ticketPrice: 399,
    capacity: 150,
    tags: ['standup', 'comedy', 'open mic', 'Bangalore nightlife', 'humor'],
    languages: ['English', 'Kannada', 'Hindi'],
    whatToExpect: ['10 acts, 4–5 min each', 'Mix of English and Hinglish sets', 'Full bar available', 'MC hosting the night'],
    whoShouldAttend: ['Comedy fans', 'Anyone who needs a good laugh', 'Friends looking for a fun night out', 'Comedy newcomers'],
    imageFile: 'standup-bangalore.png',
  },
  {
    title: 'Delhi Comedy Special — Late Night Edition',
    description:
      'A premium standup night with 2 feature comedians and 1 headliner. Darker themes, sharper writing, and a crowd that stays till midnight.',
    category: 'Standup Comedy',
    city: 'Delhi',
    venueName: 'Depot 29',
    fullAddress: '29, Hauz Khas Village, New Delhi 110016',
    latitude: 28.5505,
    longitude: 77.2009,
    eventDate: future(31),
    startTime: '09:00 PM',
    endTime: '11:30 PM',
    isFree: false,
    ticketName: 'Late Night Pass',
    ticketPrice: 599,
    capacity: 80,
    tags: ['standup', 'comedy', 'late night', 'Delhi', 'headliner'],
    languages: ['English', 'Hindi'],
    whatToExpect: ['2 feature sets + 1 headliner', 'No phones policy during show', 'Bar open all night', 'After-party mingling with comedians'],
    whoShouldAttend: ['Comedy enthusiasts', 'Night owls', 'People who love dark humour', 'Groups looking for a unique night out'],
    imageFile: 'standup-delhi.png',
  },
];

async function uploadSeedImage(s3: S3Client, bucket: string, filename: string): Promise<string | null> {
  const filePath = path.join(SEED_IMAGES_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`  MISSING   ${filename} — event will be created without cover image`);
    return null;
  }

  const ext = path.extname(filename).slice(1).toLowerCase();
  const contentType = EXT_CONTENT_TYPE[ext] ?? 'image/jpeg';
  const key = `${S3_SEED_PREFIX}/${filename}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.readFileSync(filePath),
      ContentType: contentType,
    }),
  );

  return key;
}

export async function seedEvents(prisma: PrismaClient): Promise<void> {
  console.log('\n[Events]');

  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  let s3: S3Client | null = null;
  if (bucket && region && accessKeyId && secretAccessKey) {
    s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
    console.log(`  S3 bucket : ${bucket}`);
  } else {
    console.log('  WARNING: S3 env vars not set — events will be created without images');
  }

  // Seed demo host user + profile
  const hostRole = await prisma.role.findUniqueOrThrow({ where: { name: 'HOST' } });

  const demoUser = await prisma.user.upsert({
    where: { firebaseUid: 'seed-demo-host-001' },
    update: {},
    create: {
      firebaseUid: 'seed-demo-host-001',
      email: 'demo-host@seed.local',
      firstName: 'Demo',
      lastName: 'Host',
      isActive: true,
      roleId: hostRole.id,
    },
  });

  const demoHost = await prisma.hostProfile.upsert({
    where: { userId: demoUser.id },
    update: {},
    create: {
      userId: demoUser.id,
      displayName: 'Meetday Demo Host',
      hostType: 'INDIVIDUAL',
      approvalStatus: 'APPROVED',
      approvedAt: new Date(),
    },
  });

  console.log(`  Host      ${demoUser.email} (profile: ${demoHost.id})`);

  // Build category name → id map
  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  const categoryMap = Object.fromEntries(categories.map((c) => [c.name, c.id]));

  // Seed events
  let created = 0;
  let skipped = 0;

  for (const def of EVENTS) {
    const exists = await prisma.event.findFirst({
      where: { title: def.title, hostProfileId: demoHost.id },
      select: { id: true },
    });

    if (exists) {
      console.log(`  SKIP      ${def.title}`);
      skipped++;
      continue;
    }

    const categoryId = categoryMap[def.category];
    if (!categoryId) {
      console.log(`  WARN      Category "${def.category}" not found — skipping event`);
      continue;
    }

    // Upload image
    let mediaKey: string | null = null;
    if (s3 && bucket) {
      mediaKey = await uploadSeedImage(s3, bucket, def.imageFile);
    }

    await prisma.event.create({
      data: {
        hostProfileId: demoHost.id,
        categoryId,
        title: def.title,
        description: def.description,
        city: def.city,
        venueName: def.venueName,
        fullAddress: def.fullAddress,
        latitude: def.latitude,
        longitude: def.longitude,
        eventDate: def.eventDate,
        startTime: def.startTime,
        endTime: def.endTime,
        isFree: def.isFree,
        tags: def.tags,
        languages: def.languages,
        whatToExpect: def.whatToExpect,
        whoShouldAttend: def.whoShouldAttend,
        visibility: 'PUBLIC',
        status: 'PUBLISHED',
        submittedAt: new Date(),
        ...(def.ticketName && def.ticketPrice != null
          ? {
              tickets: {
                create: {
                  name: def.ticketName,
                  price: def.ticketPrice,
                  totalCapacity: def.capacity ?? 50,
                  maxPerPerson: 4,
                  saleStartDate: new Date(),
                  saleEndDate: def.eventDate,
                },
              },
            }
          : {}),
        ...(mediaKey
          ? {
              media: {
                create: { url: mediaKey, type: MediaType.COVER, order: 0 },
              },
            }
          : {}),
      },
    });

    console.log(`  CREATED   ${def.title}`);
    created++;
  }

  console.log(`  → ${created} created, ${skipped} skipped`);
}
