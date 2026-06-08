import fs from 'fs';
import { collectMetaData, extractJSON } from './utils.js';
import { getVisionAnalysisPrompt, getProcInterPrompt } from './prompts.js';
import settings from '../settings.js';

/**
 * CSD (Component Structure Description) Generator
 * Generates structured JSON describing the agent's perception and interaction process in Minecraft.
 */
export class CSDGenerator {
    constructor(agent) {
        this.agent = agent;
        this.camera = agent.vision_interpreter?.camera;
        this.vision_model = agent.prompter.vision_model;
        this.chat_model = agent.prompter.chat_model;
    }

    /**
     * Generate the complete CSD JSON.
     * @returns {Promise<Object>} CSD JSON object
     */
    async generateCSD() {
        try {
            console.log('[CSD] Starting CSD generation...');
            
            // 1. Collect basic meta information.
            const meta = collectMetaData(this.agent);
            console.log('[CSD] Meta data collected:', {
                agent_pos: meta.agent_pos,
                facing: meta.facing,
                task: meta.task
            });

            // 2. Use vision to get observed_objects, attr, struct, and func.
            let visionResult = {};
            try {
                visionResult = await this.analyzeSceneWithVision();
                meta.observed_objects = visionResult.observed_objects || [];
                console.log('[CSD] Vision analysis completed. Observed objects:', meta.observed_objects.length);
            } catch (error) {
                console.error('[CSD] Vision analysis failed:', error);
                // Use default values.
                visionResult = {
                    observed_objects: [],
                    attr: {},
                    struct: "",
                    func: {}
                };
            }

            // 3. Use the main model to generate proc and Inter.
            let procInterResult = {};
            try {
                procInterResult = await this.generateProcAndInter(meta, visionResult);
                console.log('[CSD] Proc/Inter generation completed');
            } catch (error) {
                console.error('[CSD] Proc/Inter generation failed:', error);
                // Use default values.
                procInterResult = {
                    proc: "",
                    Inter: {
                        detailed: "",
                        summary: "",
                        hist: []
                    }
                };
            }

            // 4. Compose the final JSON.
            const csd = {
                meta,
                attr: visionResult.attr || {},
                struct: visionResult.struct || "",
                func: visionResult.func || {},
                proc: procInterResult.proc || "",
                Inter: procInterResult.Inter || {
                    detailed: "",
                    summary: "",
                    hist: []
                }
            };

            console.log('[CSD] CSD generation completed successfully');
            return csd;

        } catch (error) {
            console.error('[CSD] Error generating CSD:', error);
            throw error;
        }
    }

    /**
     * Analyze the scene with vision_model.
     * @returns {Promise<Object>} Object containing observed_objects, attr, struct, and func
     */
    async analyzeSceneWithVision() {
        if (!this.camera) {
            throw new Error('Camera not available. Vision must be enabled in settings (allow_vision: true).');
        }

        if (!this.vision_model || !this.vision_model.sendVisionRequest) {
            throw new Error('Vision model not available or does not support vision requests.');
        }

        // 1. Capture a screenshot.
        console.log('[CSD] Capturing screenshot...');
        const filename = await this.camera.capture();
        const screenshotPath = `${this.agent.vision_interpreter.fp}/${filename}.jpg`;
        
        if (!fs.existsSync(screenshotPath)) {
            throw new Error(`Screenshot file not found: ${screenshotPath}`);
        }

        const imageBuffer = fs.readFileSync(screenshotPath);

        // 2. Build the vision prompt.
        const visionPrompt = getVisionAnalysisPrompt();

        // 3. Call vision_model.
        console.log('[CSD] Calling vision model...');
        const messages = [];
        const result = await this.vision_model.sendVisionRequest(messages, visionPrompt, imageBuffer);

        // 4. Parse the JSON result.
        const parsed = extractJSON(result);
        
        if (!parsed) {
            console.warn('[CSD] Failed to parse vision response as JSON, returning empty result');
            return {
                observed_objects: [],
                attr: {},
                struct: "",
                func: {}
            };
        }

        // Validate required fields.
        return {
            observed_objects: Array.isArray(parsed.observed_objects) ? parsed.observed_objects : [],
            attr: typeof parsed.attr === 'object' && parsed.attr !== null ? parsed.attr : {},
            struct: typeof parsed.struct === 'string' ? parsed.struct : "",
            func: typeof parsed.func === 'object' && parsed.func !== null ? parsed.func : {}
        };
    }

    /**
     * Generate proc and Inter with the main model.
     * @param {Object} meta - Meta data
     * @param {Object} visionResult - Vision analysis result
     * @returns {Promise<Object>} Object containing proc and Inter
     */
    async generateProcAndInter(meta, visionResult) {
        if (!this.chat_model || !this.chat_model.sendRequest) {
            throw new Error('Chat model not available.');
        }

        // 1. Get interaction history.
        const history = this.getInteractionHistory();

        // 2. Build the prompt.
        const prompt = getProcInterPrompt(
            meta,
            visionResult.attr || {},
            visionResult.struct || "",
            visionResult.func || {},
            history
        );

        // 3. Call the main model.
        console.log('[CSD] Calling chat model for Proc/Inter generation...');
        const messages = history; // Use history as context.
        const result = await this.chat_model.sendRequest(messages, prompt);

        // 4. Parse JSON.
        const parsed = extractJSON(result);
        
        if (!parsed) {
            console.warn('[CSD] Failed to parse Proc/Inter response as JSON, returning empty result');
            return {
                proc: "",
                Inter: {
                    detailed: "",
                    summary: "",
                    hist: []
                }
            };
        }

        // Validate and format the Inter field.
        let inter = {
            detailed: "",
            summary: "",
            hist: []
        };

        if (parsed.Inter && typeof parsed.Inter === 'object') {
            inter.detailed = typeof parsed.Inter.detailed === 'string' ? parsed.Inter.detailed : "";
            inter.summary = typeof parsed.Inter.summary === 'string' ? parsed.Inter.summary : "";
            inter.hist = Array.isArray(parsed.Inter.hist) ? parsed.Inter.hist : [];
        }

        return {
            proc: typeof parsed.proc === 'string' ? parsed.proc : "",
            Inter: inter
        };
    }

    /**
     * Get interaction history.
     * @returns {Array} Formatted history array
     */
    getInteractionHistory() {
        const history = this.agent.history.getHistory();
        
        // Convert to the standard format.
        return history.map(turn => ({
            role: turn.role,
            content: turn.content
        }));
    }
}

