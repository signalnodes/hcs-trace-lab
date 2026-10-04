const assert = require("node:assert/strict");

describe("HcsTraceReceipt artifact", function () {
  it("compiles the local evidence receipt contract", async function () {
    const artifact = await hre.artifacts.readArtifact("HcsTraceReceipt");
    assert.equal(artifact.contractName, "HcsTraceReceipt");
    assert.ok(artifact.abi.some(item => item.name === "EvidenceRecorded"));
  });
});
