import { getBiomeName } from '../library/world.js';

/**
 * Convert yaw to a direction string.
 * @param {number} yaw - Horizontal rotation angle in radians
 * @returns {string} Direction string (north/south/east/west)
 */
export function getFacingDirection(yaw) {
    // yaw range: -pi to pi
    // Convert to 0-360 degrees.
    let degrees = (yaw * 180 / Math.PI + 360) % 360;
    
    // Minecraft direction mapping:
    // 0 degrees = South, 90 degrees = West, 180 degrees = North, 270 degrees = East
    if (degrees >= 315 || degrees < 45) {
        return 'south';
    } else if (degrees >= 45 && degrees < 135) {
        return 'west';
    } else if (degrees >= 135 && degrees < 225) {
        return 'north';
    } else {
        return 'east';
    }
}

/**
 * Convert timeOfDay to a time label.
 * @param {number} timeOfDay - Game time ticks (0-24000)
 * @returns {string} Time label (dawn/day/dusk/night)
 */
export function getWorldTimeLabel(timeOfDay) {
    // timeOfDay: 0-24000
    // 0 = 6:00 (dawn), 6000 = 12:00 (noon), 12000 = 18:00 (dusk), 18000 = 0:00 (midnight)
    
    if (timeOfDay >= 0 && timeOfDay < 6000) {
        return 'dawn';      // Dawn (6:00-12:00)
    } else if (timeOfDay >= 6000 && timeOfDay < 12000) {
        return 'day';       // Day (12:00-18:00)
    } else if (timeOfDay >= 12000 && timeOfDay < 18000) {
        return 'dusk';      // Dusk (18:00-0:00)
    } else {
        return 'night';     // Night (0:00-6:00)
    }
}

/**
 * Collect all meta attributes from the agent.
 * @param {Agent} agent - Agent instance
 * @returns {Object} Meta data object
 */
export function collectMetaData(agent) {
    const bot = agent.bot;
    const pos = bot.entity.position;
    
    return {
        agent_pos: [
            Number(pos.x.toFixed(2)),
            Number(pos.y.toFixed(2)),
            Number(pos.z.toFixed(2))
        ],
        facing: getFacingDirection(bot.entity.yaw),
        time_step: bot.time.age,
        world_time: getWorldTimeLabel(bot.time.timeOfDay),
        biome: getBiomeName(bot),
        task: agent.task?.goal || agent.task?.data?.goal || null,
        observed_objects: [] // Will be obtained from vision analysis.
    };
}

/**
 * Extract a JSON object from text.
 * @param {string} text - Text that may contain JSON
 * @returns {Object|null} Parsed JSON object, or null on failure
 */
export function extractJSON(text) {
    if (!text || typeof text !== 'string') {
        return null;
    }
    
    let jsonStr = text.trim();
    
    // Remove possible Markdown code fence markers.
    if (jsonStr.startsWith('```')) {
        const lines = jsonStr.split('\n');
        // Remove the first and last lines (```json and ```).
        jsonStr = lines.slice(1, -1).join('\n');
    }
    
    // Remove a possible ```json marker.
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    
    // Try to find JSON object boundaries.
    const startIdx = jsonStr.indexOf('{');
    const endIdx = jsonStr.lastIndexOf('}');
    
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        jsonStr = jsonStr.substring(startIdx, endIdx + 1);
    }
    
    try {
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error('Failed to parse JSON:', error.message);
        console.error('Text snippet:', jsonStr.substring(0, 200));
        return null;
    }
}

