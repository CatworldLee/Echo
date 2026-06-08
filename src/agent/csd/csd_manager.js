import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { CSDGenerator } from './csd_generator.js';

const CSD_FILE_PATH = './csd_data.json';

/**
 * CSD manager responsible for saving and loading CSD data.
 * CSD for all tasks is stored in one file, organized by task_id.
 */
export class CSDManager {
    constructor() {
        this.csdData = this.loadCSDData();
    }

    /**
     * Load the CSD data file.
     * @returns {Object} CSD data object in the format: { task_id: csd_object, ... }
     */
    loadCSDData() {
        if (!existsSync(CSD_FILE_PATH)) {
            return {};
        }

        try {
            const data = readFileSync(CSD_FILE_PATH, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('[CSD] Error loading CSD data:', error);
            return {};
        }
    }

    /**
     * Save CSD data to file.
     */
    saveCSDData() {
        try {
            writeFileSync(CSD_FILE_PATH, JSON.stringify(this.csdData, null, 2), 'utf8');
            console.log('[CSD] CSD data saved to', CSD_FILE_PATH);
        } catch (error) {
            console.error('[CSD] Error saving CSD data:', error);
            throw error;
        }
    }

    /**
     * Generate and save CSD for the specified task.
     * @param {Agent} agent - Agent instance
     * @param {string} taskId - Task ID
     * @returns {Promise<Object>} Generated CSD object
     */
    async generateAndSaveCSD(agent, taskId) {
        try {
            console.log(`[CSD] Generating CSD for task: ${taskId}`);
            
            // Generate CSD.
            const generator = new CSDGenerator(agent);
            const csd = await generator.generateCSD();

            // Add task ID and timestamp.
            const csdWithMetadata = {
                task_id: taskId,
                generated_at: new Date().toISOString(),
                ...csd
            };

            // Save to the data object, overwriting an existing task if present.
            this.csdData[taskId] = csdWithMetadata;

            // Save to file.
            this.saveCSDData();

            console.log(`[CSD] CSD saved for task: ${taskId}`);
            return csdWithMetadata;

        } catch (error) {
            console.error(`[CSD] Error generating/saving CSD for task ${taskId}:`, error);
            throw error;
        }
    }

    /**
     * Get CSD for the specified task.
     * @param {string} taskId - Task ID
     * @returns {Object|null} CSD object, or null if it does not exist
     */
    getCSD(taskId) {
        return this.csdData[taskId] || null;
    }

    /**
     * Get CSD for all tasks.
     * @returns {Object} All CSD data
     */
    getAllCSD() {
        return this.csdData;
    }

    /**
     * Delete CSD for the specified task.
     * @param {string} taskId - Task ID
     */
    deleteCSD(taskId) {
        if (this.csdData[taskId]) {
            delete this.csdData[taskId];
            this.saveCSDData();
            console.log(`[CSD] CSD deleted for task: ${taskId}`);
        }
    }
}

// Global singleton.
let globalCSDManager = null;

/**
 * Get the global CSD manager instance.
 * @returns {CSDManager} CSD manager instance
 */
export function getCSDManager() {
    if (!globalCSDManager) {
        globalCSDManager = new CSDManager();
    }
    return globalCSDManager;
}

