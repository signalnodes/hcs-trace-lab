// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract HcsTraceReceipt {
    event EvidenceRecorded(bytes32 indexed evidenceHash, string uri);

    mapping(bytes32 => string) public evidenceUri;

    function recordEvidence(bytes32 evidenceHash, string calldata uri) external {
        require(evidenceHash != bytes32(0), "empty evidence hash");
        require(bytes(uri).length > 0, "empty uri");
        evidenceUri[evidenceHash] = uri;
        emit EvidenceRecorded(evidenceHash, uri);
    }
}
