/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import * as path from 'path';

import {
  Command,
  SfdxCommandBuilder
} from '@salesforce/salesforcedx-utils-vscode';
import { fileUtils } from '@salesforce/salesforcedx-utils-vscode';
import {
  CancelResponse,
  ContinueResponse,
  ParametersGatherer,
  PreconditionChecker
} from '@salesforce/salesforcedx-utils-vscode';
import * as vscode from 'vscode';
import { channelService } from '../channels';
import { OrgType, workspaceContextUtils } from '../context';
import { nls } from '../messages';
import { notificationService } from '../notifications';
import { telemetryService } from '../telemetry';
import { workspaceUtils } from '../util';
import { SfdxCommandlet, SfdxCommandletExecutor } from './util/sfdxCommandlet';

export class ForceSourceDeleteExecutor extends SfdxCommandletExecutor<{
  filePath: string;
}> {
  private isSourceTracked: boolean;

  public constructor(isSourceTracked: boolean) {
    super();
    this.isSourceTracked = isSourceTracked;
  }
  public build(data: { filePath: string }): Command {
    const commandBuilder = new SfdxCommandBuilder()
      .withDescription(nls.localize('force_source_delete_text'))
      .withArg('force:source:delete')
      .withLogName('force_source_delete')
      .withFlag('--sourcepath', data.filePath)
      .withArg('--noprompt');
    if (this.isSourceTracked) {
      commandBuilder.args.push('--tracksource');
    }
    return commandBuilder.build();
  }
}

export class ManifestChecker implements PreconditionChecker {
  private explorerPath: string;

  public constructor(uri: vscode.Uri) {
    this.explorerPath = fileUtils.flushFilePath(uri.fsPath);
  }

  public check(): boolean {
    if (workspaceUtils.hasRootWorkspace()) {
      const workspaceRootPath = workspaceUtils.getRootWorkspacePath();
      const manifestPath = path.join(workspaceRootPath, 'manifest');
      const isManifestFile = this.explorerPath.includes(manifestPath);
      if (isManifestFile) {
        notificationService.showErrorMessage(
          nls.localize('force_source_delete_manifest_unsupported_message')
        );
        return false;
      }
      return true;
    }
    return false;
  }
}

export class ConfirmationAndSourcePathGatherer
  implements ParametersGatherer<{ filePath: string }> {
  private explorerPath: string;
  private readonly PROCEED = nls.localize('confirm_delete_source_button_text');
  private readonly CANCEL = nls.localize('cancel_delete_source_button_text');

  public constructor(uri: vscode.Uri) {
    this.explorerPath = fileUtils.flushFilePath(uri.fsPath);
  }

  public async gather(): Promise<
    CancelResponse | ContinueResponse<{ filePath: string }>
  > {
    const prompt = nls.localize('force_source_delete_confirmation_message');
    const response = await vscode.window.showInformationMessage(
      prompt,
      this.PROCEED,
      this.CANCEL
    );

    return response && response === this.PROCEED
      ? { type: 'CONTINUE', data: { filePath: this.explorerPath } }
      : { type: 'CANCEL' };
  }
}

export async function forceSourceDelete(sourceUri: vscode.Uri) {
  let isSourceTracked: boolean = false;
  const orgType = await workspaceContextUtils.getWorkspaceOrgType();
  if (orgType === OrgType.SourceTracked) {
    isSourceTracked = true;
  }
  if (!sourceUri) {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId !== 'forcesourcemanifest') {
      sourceUri = editor.document.uri;
    } else {
      const errorMessage = nls.localize(
        'force_source_delete_select_file_or_directory'
      );
      telemetryService.sendException('force_source_delete', errorMessage);
      notificationService.showErrorMessage(errorMessage);
      channelService.appendLine(errorMessage);
      channelService.showChannelOutput();
      return;
    }
  }
  const manifestChecker = new ManifestChecker(sourceUri);
  const commandlet = new SfdxCommandlet(
    manifestChecker,
    new ConfirmationAndSourcePathGatherer(sourceUri),
    new ForceSourceDeleteExecutor(isSourceTracked)
  );
  await commandlet.run();
}
