/**
 * CSD-related prompt templates.
 */

/**
 * Prompt template for vision analysis.
 * Used to obtain observed_objects, attr, struct, and func.
 */
export function getVisionAnalysisPrompt() {
    return `Analyze this Minecraft scene image and extract the following information in JSON format.

You must return ONLY a valid JSON object with this exact structure:
{
  "observed_objects": ["furnace", "iron_ore", "charcoal", ...],
  "attr": {
    "furnace": {
      "color": "gray",
      "shape": "cube",
      "texture": "rough stone surface"
    },
    "iron_ore": {
      "color": "gray base with brown-orange spots",
      "shape": "irregular block",
      "texture": "rough rocky texture"
    }
  },
  "struct": "There is a furnace one block in front of the Agent. Iron ore is placed in the top slot, charcoal in the bottom slot...",
  "func": {
    "furnace": "A processing device used to convert ores and fuel into finished products.",
    "iron_ore": "Raw material used as smelting input.",
    "charcoal": "Fuel used to provide energy for smelting."
  }
}

Requirements:
1. observed_objects: List all visible objects/items/entities/blocks in the scene
2. attr: For each observed object, describe its visual attributes (color, shape, texture) using concise but vivid natural language
3. struct: Provide a short spatial description of how the Agent and objects are arranged, specifying relative positions and slot contents if applicable
4. func: Describe the functional role or purpose of each object within the task context

Return only the JSON object, without any additional explanation or markdown formatting.`;
}

/**
 * Prompt template for Proc and Inter generation.
 * Used to generate process and interaction descriptions.
 */
export function getProcInterPrompt(meta, attr, struct, func, history) {
    const historyText = history.length > 0 
        ? history.map(turn => {
            const role = turn.role === 'assistant' ? 'Agent' : turn.role === 'system' ? 'System' : 'User';
            return `${role}: ${turn.content}`;
        }).join('\n')
        : 'No interaction history available.';

    return `Based on the following context about an Agent performing a task in Minecraft, generate a procedural description and interaction narrative.

Context:
- Task: ${meta.task || 'No specific task'}
- Current Environment: ${meta.biome}, ${meta.world_time}
- Agent Position: [${meta.agent_pos.join(', ')}]
- Facing: ${meta.facing}
- Observed Objects: ${meta.observed_objects.join(', ') || 'None'}

Visual Attributes:
${JSON.stringify(attr, null, 2)}

Spatial Structure:
${struct}

Object Functions:
${JSON.stringify(func, null, 2)}

Interaction History:
${historyText}

Generate a JSON object with two fields:

1. proc: A summary of the procedural steps or operational logic in one paragraph. Describe how inputs, processes, and outputs occur over time.

2. Inter: An object with three fields:
   - detailed: A narrative description of what the Agent does, sees, and hears (one paragraph)
   - summary: A concise one-line summary of the interaction
   - hist: A chronological list of past steps leading up to the current state (array of strings)

Return ONLY valid JSON with this structure:
{
  "proc": "The Agent places iron ore into the top slot of the furnace...",
  "Inter": {
    "detailed": "The Agent walks up to the furnace and opens its interface...",
    "summary": "The Agent uses the furnace to smelt iron ore into iron ingots.",
    "hist": [
      "The Agent collected iron ore and charcoal.",
      "The Agent crafted and placed a furnace.",
      "The Agent loaded iron ore and charcoal into the furnace."
    ]
  }
}

Return only the JSON object, without any additional explanation or markdown formatting.`;
}

