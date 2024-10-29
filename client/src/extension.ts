/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import * as path from 'path';
import {workspace, ExtensionContext} from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';
import { exec } from 'child_process';
import { join } from 'path';
import * as fs from 'fs';


let client: LanguageClient;

export function activate(context: ExtensionContext) {
    let disposable = vscode.commands.registerCommand('angel-lsp.runNGT', () => {
        const command = "C:/Program Files/NGT/NGT -p";
        
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error("Error executing command: ${error.message}");
                return;
            }
            if (stderr) {
                console.error("stderr: ${stderr}");
                return;
            }
            console.log("stdout: ${stdout}");
        });
    });

    context.subscriptions.push(disposable);
    vscode.commands.executeCommand('angel-lsp.runNGT');
    // The server is implemented in node
    const serverModule = context.asAbsolutePath(
        path.join('server', 'out', 'server.js')
    );

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: {module: serverModule, transport: TransportKind.ipc},
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
        }
    };

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
        documentSelector: [
            {scheme: 'file', language: 'angelscript'},
            {scheme: 'file', language: 'angelscript-predefined'}
        ],
        synchronize: {
            // Notify the server about file changes to '.clientrc files contained in the workspace
            fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
        }
    };

    // Create the language client and start the client.
    client = new LanguageClient(
        'angelScript',
        'AngelScript Language Server',
        serverOptions,
        clientOptions
    );

    // Start the client. This will also launch the server
    client.start();
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
