import { z } from "zod";
import axios from "axios";

// RapidAPI configuration — twitter-api45 backend (alexanderxbx)
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "twitter-api45.p.rapidapi.com";

export function registerTwitterTools(server) {
  const performTwitterSearch = async (query, section, limit, inReplyTo) => {
    if (!RAPIDAPI_KEY) {
      throw new Error("RAPIDAPI_KEY environment variable is not set");
    }

    console.error(`TWITTER SEARCH: ${query}${inReplyTo ? ` [inReplyTo=${inReplyTo}]` : ""}`);

    // twitter-api45 returns ~20 tweets per page; paginate via next_cursor.
    // When inReplyTo is set, fetch up to maxPages to compensate for client-side filter.
    const searchType = section.charAt(0).toUpperCase() + section.slice(1); // top → Top
    const maxPages = inReplyTo ? 5 : Math.ceil(limit / 20);
    let allTweets = [];
    let cursor = null;
    let pages = 0;

    while (allTweets.length < limit && pages < maxPages) {
      pages++;
      const params = new URLSearchParams({
        query: query,
        search_type: searchType,
      });
      if (cursor) params.append("cursor", cursor);

      const response = await axios({
        method: "GET",
        url: `https://${RAPIDAPI_HOST}/search.php?${params.toString()}`,
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": RAPIDAPI_HOST,
        },
      });

      let newTweets = (response.data.timeline || []).filter(
        (t) => t.type === "tweet"
      );
      if (inReplyTo) {
        newTweets = newTweets.filter(
          (t) => t.in_reply_to_status_id_str === inReplyTo
        );
      }
      allTweets = [...allTweets, ...newTweets];

      cursor = response.data.next_cursor;
      if (!cursor) break;
    }

    return allTweets.slice(0, limit);
  };

  server.tool(
    "searchTwitter",
    {
      query: z.string().min(1, "Search query is required"),
      section: z.enum(["latest", "top"]).optional().default("latest"),
      limit: z.number().int().positive().optional().default(20),
      inReplyTo: z
        .string()
        .optional()
        .describe(
          "Filter results to direct replies of this tweet ID. Combine with `conversation_id:<id>` in query for thread-scoped reply listing."
        ),
    },
    async ({ query, section, limit, inReplyTo }) => {
      try {
        const tweets = await performTwitterSearch(query, section, limit, inReplyTo);
        return {
          content: [
            {
              type: "text",
              text: formatTwitterResults(query, tweets, section),
            },
          ],
        };
      } catch (error) {
        console.error("Error searching Twitter:", error);
        return {
          content: [
            {
              type: "text",
              text: `Error searching Twitter: ${error.message}`,
            },
          ],
        };
      }
    }
  );
}

function formatTwitterResults(query, tweets, section) {
  if (!tweets || tweets.length === 0) {
    return `No tweets found for query: ${query}`;
  }

  const output = [];

  tweets.forEach((tweet, index) => {
    const username = tweet.screen_name;
    const u = tweet.user_info || {};

    output.push(`## [${index + 1}] Tweet by @${username}`);

    let userInfo = `**User:** ${u.name || username} (@${username})`;
    if (u.verified) userInfo += ` [Verified]`;
    output.push(userInfo);

    const userStats = [];
    if (u.followers_count !== undefined) userStats.push(`${u.followers_count} followers`);
    if (u.friends_count !== undefined) userStats.push(`${u.friends_count} following`);
    if (userStats.length > 0) {
      output.push(`**Account stats:** ${userStats.join(", ")}`);
    }

    output.push(`\n**Content:** ${tweet.text}\n`);

    const metrics = [];
    metrics.push(`${tweet.favorites ?? 0} likes`);
    metrics.push(`${tweet.retweets ?? 0} retweets`);
    metrics.push(`${tweet.replies ?? 0} replies`);
    if (tweet.quotes) metrics.push(`${tweet.quotes} quotes`);
    if (tweet.bookmarks) metrics.push(`${tweet.bookmarks} bookmarks`);
    if (tweet.views) metrics.push(`${tweet.views} views`);
    output.push(`**Engagement:** ${metrics.join(" | ")}`);

    try {
      const date = new Date(tweet.created_at);
      const formattedDate = !isNaN(date.getTime())
        ? `${date.toLocaleDateString("en-GB")} ${date.toLocaleTimeString("en-GB")}`
        : "Date unavailable";
      output.push(`**Posted:** ${formattedDate}`);
    } catch (e) {
      output.push(`**Posted:** Date format error`);
    }

    if (tweet.in_reply_to_status_id_str) {
      output.push(`**Reply to:** https://twitter.com/status/${tweet.in_reply_to_status_id_str}`);
    }

    if (tweet.media) {
      const photos = tweet.media.photo || [];
      const videos = tweet.media.video || [];
      if (photos.length > 0) {
        output.push(`**Photos:** ${photos.length}`);
        photos.forEach((p) => output.push(`  - ${p.media_url_https}`));
      }
      if (videos.length > 0) {
        output.push(`**Videos:** ${videos.length}`);
        videos.forEach((v) => {
          const mp4 = (v.variants || [])
            .filter((x) => x.content_type === "video/mp4")
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
          if (mp4) output.push(`  - ${mp4.url}`);
        });
      }
    }

    if (tweet.tweet_id && username) {
      output.push(`**URL:** https://twitter.com/${username}/status/${tweet.tweet_id}`);
    }

    output.push("\n---\n");
  });

  return output.join("\n");
}
