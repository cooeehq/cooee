import { runDailyChangelogCron } from "./daily-runner";

const result = await runDailyChangelogCron();

console.log(`Processed ${result.processed} due changelog(s).`);
