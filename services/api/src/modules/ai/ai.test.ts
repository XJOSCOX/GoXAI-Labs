import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { labelStudioResultsToRegions, normalizePredictionEnvelope, parseDatasetPredictionRows } from "./ai.js";

describe("normalizePredictionEnvelope", () => {
  it("normalizes native bbox and polygon prediction payloads", () => {
    const result = normalizePredictionEnvelope({
      modelVersion: "manual-v1",
      regions: [
        {
          confidence: 0.92,
          geometry: {
            height: 0.3,
            width: 0.4,
            x: 0.1,
            y: 0.2
          },
          label: "Horse",
          type: "BBOX"
        },
        {
          geometry: {
            points: [
              { x: 0.1, y: 0.1 },
              { x: 0.2, y: 0.1 },
              { x: 0.2, y: 0.2 }
            ]
          },
          label: "Fence",
          type: "POLYGON"
        }
      ],
      results: [
        {
          fromName: "caption",
          toName: "image",
          type: "textarea",
          value: {
            text: ["Outdoor scene"]
          }
        }
      ],
      summary: "Two regions"
    });

    assert.equal(result.ok, true);

    if (!result.ok) {
      return;
    }

    assert.equal(result.modelVersion, "manual-v1");
    assert.equal(result.regions.length, 2);
    assert.equal(result.regions[0].confidence, 0.92);
    assert.deepEqual(result.results[0], {
      fromName: "caption",
      toName: "image",
      type: "textarea",
      value: {
        text: ["Outdoor scene"]
      }
    });
  });

  it("converts Label Studio rectangle and polygon results to normalized regions", () => {
    const result = normalizePredictionEnvelope({
      result: [
        {
          score: 0.87,
          type: "rectanglelabels",
          value: {
            height: 30,
            rectanglelabels: ["Horse"],
            width: 40,
            x: 10,
            y: 20
          }
        },
        {
          type: "polygonlabels",
          value: {
            points: [
              [10, 10],
              [25, 10],
              [25, 25]
            ],
            polygonlabels: ["Fence"]
          }
        }
      ],
      score: 0.8
    });

    assert.equal(result.ok, true);

    if (!result.ok) {
      return;
    }

    assert.equal(result.source, "label_studio");
    assert.deepEqual(result.regions[0], {
      confidence: 0.87,
      geometry: {
        height: 0.3,
        width: 0.4,
        x: 0.1,
        y: 0.2
      },
      label: "Horse",
      metadata: null,
      type: "BBOX"
    });
    assert.deepEqual(result.regions[1], {
      confidence: 0.8,
      geometry: {
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.25, y: 0.1 },
          { x: 0.25, y: 0.25 }
        ]
      },
      label: "Fence",
      metadata: null,
      type: "POLYGON"
    });
  });

  it("rejects malformed geometry before creating a prediction job", () => {
    const result = normalizePredictionEnvelope({
      regions: [
        {
          geometry: {
            height: 0,
            width: 0.5,
            x: 0.1,
            y: 0.2
          },
          type: "BBOX"
        }
      ]
    });

    assert.equal(result.ok, false);

    if (result.ok) {
      return;
    }

    assert.match(result.error, /Bounding boxes/);
  });
});

describe("labelStudioResultsToRegions", () => {
  it("skips unsupported Label Studio result types without failing the import", () => {
    const regions = labelStudioResultsToRegions(
      [
        {
          type: "choices",
          value: {
            choices: ["No object"]
          }
        },
        {
          type: "rectanglelabels",
          value: {
            height: 10,
            rectanglelabels: ["Car"],
            width: 20,
            x: 15,
            y: 30
          }
        }
      ],
      null
    );

    assert.equal(regions.length, 1);
    assert.equal(regions[0].label, "Car");
  });
});

describe("parseDatasetPredictionRows", () => {
  it("accepts JSON arrays with task and asset matching fields", () => {
    const result = parseDatasetPredictionRows([
      {
        taskId: "task-1",
        regions: [
          {
            geometry: {
              height: 0.2,
              width: 0.3,
              x: 0.1,
              y: 0.1
            },
            label: "Horse",
            type: "BBOX"
          }
        ]
      },
      {
        assetName: "horse-2.jpg",
        predictions: {
          regions: [
            {
              geometry: {
                height: 0.2,
                width: 0.3,
                x: 0.1,
                y: 0.1
              },
              label: "Horse",
              type: "BBOX"
            }
          ]
        }
      }
    ]);

    assert.equal(result.ok, true);

    if (!result.ok) {
      return;
    }

    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].taskId, "task-1");
    assert.equal(result.rows[1].assetName, "horse-2.jpg");
  });

  it("accepts JSONL prediction imports", () => {
    const result = parseDatasetPredictionRows(
      [
        JSON.stringify({
          file_name: "horse-1.jpg",
          regions: [
            {
              geometry: {
                height: 0.2,
                width: 0.3,
                x: 0.1,
                y: 0.1
              },
              type: "BBOX"
            }
          ]
        }),
        JSON.stringify({
          task_id: "task-2",
          predictions: {
            result: [
              {
                type: "rectanglelabels",
                value: {
                  height: 20,
                  rectanglelabels: ["Horse"],
                  width: 30,
                  x: 10,
                  y: 10
                }
              }
            ]
          }
        })
      ].join("\n")
    );

    assert.equal(result.ok, true);

    if (!result.ok) {
      return;
    }

    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].assetName, "horse-1.jpg");
    assert.equal(result.rows[1].taskId, "task-2");
  });

  it("rejects malformed JSONL with a useful line number", () => {
    const result = parseDatasetPredictionRows("{\"taskId\":\"ok\"}\n{bad");

    assert.equal(result.ok, false);

    if (result.ok) {
      return;
    }

    assert.match(result.error, /line 2/);
  });
});
