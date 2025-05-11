(async function automateModelExportBatch() {
    console.log("Starting automated CEM model export batch");
    try {
        if (!window.cemTemplateModelsLoaded) {
            console.log("Loading CEM template models data...");
            await window.loadCEMTemplateModels();
        }

        if (!modelData || !modelData.entities) {
            console.error("Failed to load model data!");
            return;
        }

        console.log(`Found ${modelData.entities.length} entities to process`);

        const entitiesToProcess = modelData.entities.filter(entity =>
            !entity.type && entity.name && typeof entity.name === 'string'
        );

        const processCount = prompt(`Found ${entitiesToProcess.length} models. How many would you like to process? (Enter a number or 'all')`, "5");

        const limit = processCount.toLowerCase() === 'all' ?
            entitiesToProcess.length :
            parseInt(processCount) || 5;

        console.log(`Processing ${limit} models...`);

        let processedCount = 0;
        let successCount = 0;

        for (const entity of entitiesToProcess) {
            if (processedCount >= limit) break;

            try {
                console.log(`\n--- Processing ${processedCount + 1}/${limit}: ${entity.name} ---`);
                await loadModel(entity.name, true);
                await new Promise(resolve => setTimeout(resolve, 1000));
                await exportGLTFWithName(entity.name);
                await new Promise(resolve => setTimeout(resolve, 2000));
                processedCount++;
                successCount++;
                console.log(`✅ Completed: ${entity.name}`);

            } catch (error) {
                console.error(`Error processing ${entity.name}:`, error);
                processedCount++;
            }
        }

        console.log(`\n=== Export completed! ===`);
        console.log(`Processed: ${processedCount} models`);
        console.log(`Successfully exported: ${successCount} models`);

    } catch (error) {
        console.error('Error during batch export:', error);
    }
    async function exportGLTFWithName(entityName) {
        console.log(`Exporting ${entityName} to GLTF...`);
        const options = {
            encoding: "ascii",
            scale: 16,
            embed_textures: true,
            armature: false,
            animations: true
        };
        const exporter = new THREE.GLTFExporter();
        if (BarItems.view_mode.value !== 'textured') {
            BarItems.view_mode.set('textured');
            BarItems.view_mode.onChange();
        }
        const gl_scene = new THREE.Scene();
        gl_scene.name = 'blockbench_export';
        gl_scene.add(Project.model_3d);
        const result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Export timed out")), 15000);
            exporter.parse(gl_scene, result => {
                clearTimeout(timeout);
                resolve(result);
            }, {
                onlyVisible: false,
                trs: true,
                binary: options.encoding === 'binary',
                truncateDrawRange: false,
                forcePowerOfTwoTextures: true,
                scale_factor: 1 / options.scale,
                embedImages: options.embed_textures !== false,
                exportFaceColors: false,
                animations: []
            });
        });

        const content = options.encoding === 'binary' ? result : JSON.stringify(result);
        const fileExtension = options.encoding === 'binary' ? 'glb' : 'gltf';

        const sanitizedName = entityName.replace(/[/\\?%*:|"<>]/g, '_');
        const fileName = `${sanitizedName}.${fileExtension}`;

        console.log(`Preparing download as: ${fileName}`);

        const blob = new Blob([content], {
            type: options.encoding === 'binary' ? 'model/gltf-binary' : 'model/gltf+json'
        });

        if (typeof Blockbench.export === 'function') {
            Blockbench.export({
                resource_id: 'gltf',
                type: 'GLTF Model',
                extensions: [fileExtension],
                name: sanitizedName,
                content: content,
            });
            console.log(`Exported ${fileName} using Blockbench's export function`);

            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.setAttribute('download', fileName);
            a.setAttribute('href', url);
            a.style.display = 'none';
            document.body.appendChild(a);

            await new Promise(resolve => setTimeout(resolve, 100));

            a.click();

            await new Promise(resolve => {
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    resolve();
                }, 1000);
            });

            console.log(`Downloaded ${fileName} using createObjectURL approach`);
        }
        if (scene && Project.model_3d) {
            scene.add(Project.model_3d);
        }

        return true;
    }
})();