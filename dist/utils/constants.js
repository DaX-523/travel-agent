"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tavilyFallBack = exports.complexPatterns = exports.checker_prompt = exports.fallBackTemplate = void 0;
exports.fallBackTemplate = `1. **Major Cities**: Explore the urban centers with their unique architecture, museums, historical sites, and vibrant culture.

2. **Natural Wonders**: Discover the breathtaking landscapes including mountains, beaches, forests, and national parks.

3. **Historical Sites**: Visit ancient temples, colonial buildings, museums, and cultural landmarks throughout the region.

4. **Local Experiences**: Immerse yourself in local culture through food tours, traditional performances, markets, and community-based tourism.

5. **Outdoor Activities**: Enjoy hiking, water sports, wildlife watching, and adventure activities suited to the local geography.

6. **Culinary Highlights**: Sample regional specialties, street food, and local delicacies that define the destination's cuisine.

7. **Hidden Gems**: Explore off-the-beaten-path locations away from typical tourist crowds for a more authentic experience.

8. **Practical Tips**: Consider visiting during the dry season, use local transportation options, and respect cultural customs during your travels.`;
exports.checker_prompt = `I am thinking of calling the info tool with the info below. \
Is this good? Give your reasoning as well. \
You can encourage the Assistant to look at specific URLs if that seems relevant, or do more searches.
If you don't think it is good, you should be very specific about what could be improved.

{presumed_info}`;
exports.complexPatterns = [
    /\bcompare\b/i,
    /\bbest\b/i,
    /\brecommend\b/i,
    /\bplan\b/i,
    /\bitinerary\b/i,
    /\btrip\b/i,
    /\bvisit\b/i,
    /\bcustom\b/i,
    /\bwhat should\b/i,
    /\bhow can\b/i,
    /\badvice\b/i,
    /\bsuggestion\b/i,
    /days?\sin\b/i,
    /\bfamily\b/i,
    /\bbudget\b/i,
    /\boptions\b/i,
    /\bhelp me\b/i,
    /\bmultiple\b/i,
];
exports.tavilyFallBack = `1. **Popular Cities**: Major urban centers with unique architecture, museums, historical sites, and vibrant local culture.

2. **Natural Wonders**: Breathtaking landscapes including mountains, beaches, forests, and national parks.

3. **Historical Sites**: Ancient temples, colonial buildings, museums, and cultural landmarks that showcase the region's rich history.

4. **Local Experiences**: Immerse yourself in local culture through food tours, traditional performances, markets, and community-based tourism.

5. **Outdoor Activities**: Hiking, water sports, wildlife watching, and adventure activities suited to the local geography.

6. **Culinary Highlights**: Regional specialties, street food, and local delicacies that define the destination's cuisine.

7. **Hidden Gems**: Off-the-beaten-path locations away from typical tourist crowds for a more authentic experience.

8. **Practical Tips**: Consider visiting during the dry season, use local transportation options, and respect cultural customs during your travels.

Based on web search results (search engine temporarily unavailable, using general travel information).`;
