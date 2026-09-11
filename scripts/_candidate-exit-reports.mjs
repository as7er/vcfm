// A shared listener keeps long candidate compositions below EventEmitter's
// listener warning threshold; each layer still emits its own effective hash.
const reports = [];
process.once("exit", () => {
  for (const report of reports) console.log(JSON.stringify(report()));
});
export const reportCandidateOnExit = (report) => { reports.push(report); };
