/**
 * A Robot session log as Mr. Robot stored it on DSH 0.2.0-rc.2 (v1.14 ticket 01, ao-wzw9): one Turn where the
 * owner says "Hi there", the model thinks, reacts through run_code and replies. Captured from a real Turn on
 * the stub model; only the platform prompt and the memory notice text are shortened. The header has no
 * session id: the test stores the log under the Robot's live session id.
 */
export const OLD_SESSION_HEADER = {
  "version": 4,
  "createdAt": 1792401306939,
  "cwd": "/workspace",
  "isSeeded": false
}

export const OLD_SESSION_EVENTS: ReadonlyArray<{ readonly type: string; readonly seq: number; readonly [field: string]: unknown }> = [
  {
    "type": "agent/inbox/spliced",
    "seq": 0,
    "time": 1792401306958,
    "data": {
      "target": "next-turn",
      "start": 0,
      "inserted": [
        {
          "content": [
            {
              "type": "text",
              "text": "[Mon 2026-10-19 11:15 Europe/Warsaw]\nHi there"
            }
          ],
          "source": {
            "kind": "member",
            "memberId": "m-owner",
            "name": "Owner",
            "attachments": []
          },
          "role": "user",
          "id": "e627dbfc-a205-42ff-ac9e-48462b60d31c"
        }
      ]
    }
  },
  {
    "type": "turn/start",
    "seq": 1,
    "time": 1792401306960,
    "data": {
      "turn": 1
    }
  },
  {
    "type": "agent/inbox/spliced",
    "seq": 2,
    "time": 1792401306960,
    "data": {
      "target": "next-turn",
      "start": 0,
      "removedCount": 1,
      "inserted": []
    }
  },
  {
    "type": "step/start",
    "seq": 3,
    "time": 1792401306974,
    "data": {
      "turn": 1,
      "step": 1
    }
  },
  {
    "type": "system/message",
    "seq": 4,
    "time": 1792401306975,
    "data": {
      "turn": 1,
      "step": 1,
      "message": {
        "role": "system",
        "content": [
          {
            "type": "text",
            "text": "You are r-old, a Robot owned by Owner. (The rest of the platform prompt is cut from this fixture.)"
          }
        ],
        "source": {
          "kind": "system-prompt"
        },
        "id": "6854e420-b0d9-4622-9082-a17a3ddc834d"
      }
    },
    "surfaceOp": "append"
  },
  {
    "type": "user/message",
    "seq": 5,
    "time": 1792401306976,
    "data": {
      "content": [
        {
          "type": "text",
          "text": "[Mon 2026-10-19 11:15 Europe/Warsaw]\nHi there"
        }
      ],
      "source": {
        "kind": "member",
        "memberId": "m-owner",
        "name": "Owner",
        "attachments": []
      },
      "role": "user",
      "id": "e627dbfc-a205-42ff-ac9e-48462b60d31c"
    },
    "surfaceOp": "append"
  },
  {
    "type": "user/message",
    "seq": 6,
    "time": 1792401306976,
    "data": {
      "content": [
        {
          "type": "text",
          "text": "<system-reminder>\nYour memory and persona files as of now. (Their text is cut from this fixture.)\n</system-reminder>"
        }
      ],
      "source": {
        "kind": "platform",
        "summary": "",
        "form": "notice",
        "hidden": true,
        "memory": "baseline"
      },
      "role": "user",
      "id": "ced78a65-a288-4813-8d46-866c6063e44e"
    },
    "surfaceOp": "append"
  },
  {
    "type": "request/header",
    "seq": 7,
    "time": 1792401306976,
    "data": {
      "header": {
        "config": {
          "provider": "stub",
          "model": "stub",
          "maxTokens": 32000
        },
        "adapterDefaults": {
          "maxTokens": true
        },
        "tools": [
          {
            "name": "run_code",
            "description": "Execute a TypeScript program against the available tools. Takes two required arguments: `code`, the BODY of an async function (erasable syntax only; top-level `await` and `return` work), and `description`, a short summary of what the program does. Call tools as `await tools.name(args)` per the declarations in the system prompt. Only what you print or return is program output — curate it. Image-bearing subtool results are attached after the run. Each program runs in a fresh isolated JavaScript runtime with no network and no filesystem; only the tool bindings reach the outside. Use top-level await and return a JSON value. The working directory is the Session's current directory.",
            "parameters": {
              "type": "object",
              "properties": {
                "code": {
                  "type": "string",
                  "description": "The program: the body of an async TypeScript function."
                },
                "description": {
                  "type": "string",
                  "description": "Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: \"Count TODO markers across packages\"; \"Read failing test and its fixture\"; \"Rename config key in every cordis.yml\"."
                },
                "timeoutMs": {
                  "type": "number",
                  "description": "Positive elapsed-time budget in milliseconds, including nested tool and approval waits. Default 120000; capped at 600000. Zero does not disable the deadline."
                }
              },
              "required": [
                "code",
                "description"
              ]
            }
          }
        ]
      },
      "reason": "initial"
    }
  },
  {
    "type": "request/context",
    "seq": 8,
    "time": 1792401306977,
    "data": {
      "provider": "stub",
      "model": "stub",
      "contextWindow": 128000
    }
  },
  {
    "type": "assistant/message",
    "seq": 9,
    "time": 1792401306978,
    "data": {
      "turn": 1,
      "step": 1,
      "message": {
        "role": "assistant",
        "content": [
          {
            "type": "reasoning",
            "text": "The owner greets me."
          },
          {
            "type": "text",
            "text": "Let me react."
          },
          {
            "type": "tool-call",
            "id": "call-73688b3e-465a-4fa2-9642-2dd6f86ce1f6",
            "name": "run_code",
            "arguments": "{\"code\":\"await tools.react({ emoji: '👀' }); return 'reacted'\",\"description\":\"React to the message\"}"
          }
        ],
        "source": {
          "kind": "model",
          "provider": "stub",
          "model": "stub"
        },
        "id": "ea9cc409-b76b-4ab1-b5bb-01129470b8b8"
      },
      "usage": {
        "inputTokens": 100,
        "outputTokens": 10
      },
      "stream": [
        {
          "type": "chunk",
          "time": 1792401306977,
          "chunk": {
            "type": "block-start",
            "index": 0,
            "blockType": "reasoning"
          }
        },
        {
          "type": "reasoning-chunks",
          "time0": 1792401306977,
          "index": 0,
          "dt": [],
          "texts": [
            "The owner greets me."
          ]
        },
        {
          "type": "chunk",
          "time": 1792401306978,
          "chunk": {
            "type": "block-end",
            "index": 0,
            "block": {
              "type": "reasoning",
              "text": "The owner greets me."
            }
          }
        },
        {
          "type": "chunk",
          "time": 1792401306978,
          "chunk": {
            "type": "block-start",
            "index": 1,
            "blockType": "text"
          }
        },
        {
          "type": "text-chunks",
          "time0": 1792401306978,
          "index": 1,
          "dt": [],
          "texts": [
            "Let me react."
          ]
        },
        {
          "type": "chunk",
          "time": 1792401306978,
          "chunk": {
            "type": "block-end",
            "index": 1,
            "block": {
              "type": "text",
              "text": "Let me react."
            }
          }
        },
        {
          "type": "chunk",
          "time": 1792401306978,
          "chunk": {
            "type": "block-start",
            "index": 2,
            "blockType": "tool-call"
          }
        },
        {
          "type": "tool-call-chunks",
          "time0": 1792401306978,
          "index": 2,
          "dt": [],
          "id": "call-73688b3e-465a-4fa2-9642-2dd6f86ce1f6",
          "name": "run_code",
          "args": [
            "{\"code\":\"await tools.react({ emoji: '👀' }); return 'reacted'\",\"description\":\"React to the message\"}"
          ]
        },
        {
          "type": "chunk",
          "time": 1792401306978,
          "chunk": {
            "type": "block-end",
            "index": 2,
            "block": {
              "type": "tool-call",
              "id": "call-73688b3e-465a-4fa2-9642-2dd6f86ce1f6",
              "name": "run_code",
              "arguments": "{\"code\":\"await tools.react({ emoji: '👀' }); return 'reacted'\",\"description\":\"React to the message\"}"
            }
          }
        },
        {
          "type": "chunk",
          "time": 1792401306978,
          "chunk": {
            "type": "usage",
            "usage": {
              "inputTokens": 100,
              "outputTokens": 10
            }
          }
        },
        {
          "type": "chunk",
          "time": 1792401306978,
          "chunk": {
            "type": "finish",
            "reason": {
              "kind": "tool-calls"
            }
          }
        }
      ]
    },
    "surfaceOp": "append"
  },
  {
    "type": "tool/call",
    "seq": 10,
    "time": 1792401306979,
    "data": {
      "turn": 1,
      "step": 1,
      "callId": "call-73688b3e-465a-4fa2-9642-2dd6f86ce1f6",
      "name": "run_code",
      "arguments": "{\"code\":\"await tools.react({ emoji: '👀' }); return 'reacted'\",\"description\":\"React to the message\"}"
    }
  },
  {
    "type": "tool/ptc-dispatch-start",
    "seq": 11,
    "time": 1792401306989,
    "data": {
      "rootCallId": "call-73688b3e-465a-4fa2-9642-2dd6f86ce1f6",
      "parentCallId": "call-73688b3e-465a-4fa2-9642-2dd6f86ce1f6",
      "subCallId": "call-73688b3e-465a-4fa2-9642-2dd6f86ce1f6:ptc:1",
      "name": "react",
      "arguments": {
        "emoji": "👀"
      }
    }
  },
  {
    "type": "tool/ptc-dispatch",
    "seq": 12,
    "time": 1792401306989,
    "data": {
      "rootCallId": "call-73688b3e-465a-4fa2-9642-2dd6f86ce1f6",
      "parentCallId": "call-73688b3e-465a-4fa2-9642-2dd6f86ce1f6",
      "subCallId": "call-73688b3e-465a-4fa2-9642-2dd6f86ce1f6:ptc:1",
      "name": "react",
      "arguments": {
        "emoji": "👀"
      },
      "isError": false,
      "content": [
        {
          "type": "text",
          "text": "{\n  \"status\": \"reacted\",\n  \"message\": \"Reacted with 👀. End the Turn without a reply unless one is needed.\"\n}"
        }
      ]
    }
  },
  {
    "type": "tool/result",
    "seq": 13,
    "time": 1792401306993,
    "data": {
      "turn": 1,
      "step": 1,
      "message": {
        "role": "tool",
        "source": {
          "kind": "tool",
          "callId": "call-73688b3e-465a-4fa2-9642-2dd6f86ce1f6"
        },
        "toolCallId": "call-73688b3e-465a-4fa2-9642-2dd6f86ce1f6",
        "content": [
          {
            "type": "text",
            "text": "reacted"
          }
        ],
        "isError": false,
        "id": "40ea989b-dca3-49a9-8448-dde384b36764"
      }
    },
    "sourceEventSeqs": [
      10
    ],
    "surfaceOp": "append"
  },
  {
    "type": "step/end",
    "seq": 14,
    "time": 1792401306994,
    "data": {
      "turn": 1,
      "step": 1
    }
  },
  {
    "type": "step/start",
    "seq": 15,
    "time": 1792401306996,
    "data": {
      "turn": 1,
      "step": 2
    }
  },
  {
    "type": "assistant/message",
    "seq": 16,
    "time": 1792401306997,
    "data": {
      "turn": 1,
      "step": 2,
      "message": {
        "role": "assistant",
        "content": [
          {
            "type": "text",
            "text": "Hello, owner. I saw your message."
          }
        ],
        "source": {
          "kind": "model",
          "provider": "stub",
          "model": "stub"
        },
        "id": "c005b4ea-407b-4498-9564-ed7dfcfbeb68"
      },
      "usage": {
        "inputTokens": 100,
        "outputTokens": 10
      },
      "stream": [
        {
          "type": "chunk",
          "time": 1792401306997,
          "chunk": {
            "type": "block-start",
            "index": 0,
            "blockType": "text"
          }
        },
        {
          "type": "text-chunks",
          "time0": 1792401306997,
          "index": 0,
          "dt": [],
          "texts": [
            "Hello, owner. I saw your message."
          ]
        },
        {
          "type": "chunk",
          "time": 1792401306997,
          "chunk": {
            "type": "block-end",
            "index": 0,
            "block": {
              "type": "text",
              "text": "Hello, owner. I saw your message."
            }
          }
        },
        {
          "type": "chunk",
          "time": 1792401306997,
          "chunk": {
            "type": "usage",
            "usage": {
              "inputTokens": 100,
              "outputTokens": 10
            }
          }
        },
        {
          "type": "chunk",
          "time": 1792401306997,
          "chunk": {
            "type": "finish",
            "reason": {
              "kind": "stop"
            }
          }
        }
      ]
    },
    "surfaceOp": "append"
  },
  {
    "type": "step/end",
    "seq": 17,
    "time": 1792401306997,
    "data": {
      "turn": 1,
      "step": 2
    }
  },
  {
    "type": "turn/end",
    "seq": 18,
    "time": 1792401306997,
    "data": {
      "turn": 1,
      "reason": {
        "kind": "completed"
      }
    }
  }
]
