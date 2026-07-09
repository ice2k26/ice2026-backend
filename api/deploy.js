// Redeploys to the fixed deployment ID so the /exec URL never changes.
const { execSync } = require("child_process");
const { DEPLOYMENT_ID } = require("./deployment.json");
function run(cmd) { console.log(`\n> ${cmd}`); execSync(cmd, { stdio: "inherit" }); }
run("npx clasp push --force");
run(`npx clasp deploy --deploymentId ${DEPLOYMENT_ID} --description "release ${new Date().toISOString()}"`);
