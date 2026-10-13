/**
 * Stood platform APILib
 *
 * This file was automatically generated for Stood by Maku Mazakpe by APIMATIC v3.0 ( https://www.apimatic.io ).
 */

import { ApiResponse, RequestOptions } from '../core.js';
import { Allowance, allowanceSchema } from '../models/allowance.js';
import {
  AllowanceDraft,
  allowanceDraftSchema,
} from '../models/allowanceDraft.js';
import {
  AllowanceProposal,
  allowanceProposalSchema,
} from '../models/allowanceProposal.js';
import {
  AllowanceVersion,
  allowanceVersionSchema,
} from '../models/allowanceVersion.js';
import { Baseline, baselineSchema } from '../models/baseline.js';
import {
  CodeTermsInput,
  codeTermsInputSchema,
} from '../models/codeTermsInput.js';
import { CommitPackage, commitPackageSchema } from '../models/commitPackage.js';
import {
  CommitPackageInput,
  commitPackageInputSchema,
} from '../models/commitPackageInput.js';
import { Funding, fundingSchema } from '../models/funding.js';
import {
  FundingRequest,
  fundingRequestSchema,
} from '../models/fundingRequest.js';
import { Mandate, mandateSchema } from '../models/mandate.js';
import { Tranche, trancheSchema } from '../models/tranche.js';
import { UploadInput, uploadInputSchema } from '../models/uploadInput.js';
import { UploadSession, uploadSessionSchema } from '../models/uploadSession.js';
import {
  UsageAcceptance,
  usageAcceptanceSchema,
} from '../models/usageAcceptance.js';
import { UsageReceipt, usageReceiptSchema } from '../models/usageReceipt.js';
import { optional, string, unknown } from '../schema.js';
import { BaseApi } from './baseApi.js';
import { ProblemError } from '../errors/problemError.js';

export class Api extends BaseApi {
  /**
   * @param idempotencyKey  Same key and body return the same response; a different body is
   *                                                 409
   * @param body
   * @return Response from the API call
   */
  async createAllowance(
    idempotencyKey: string,
    body: AllowanceDraft,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<Allowance>> {
    const req = this.createRequest('POST', '/allowances');
    const mapped = req.prepareArgs({
      idempotencyKey: [idempotencyKey, string()],
      body: [body, allowanceDraftSchema],
    });
    req.header('Idempotency-Key', mapped.idempotencyKey);
    req.header('Content-Type', 'application/json');
    req.json(mapped.body);
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(409, ProblemError, 'Idempotency or version conflict');
    req.throwOn(413, ProblemError, 'Body over 64 KiB');
    req.throwOn(422, ProblemError, 'Invalid request');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(allowanceSchema, requestOptions);
  }

  /**
   * @param id
   * @return Response from the API call
   */
  async getAllowance(
    id: string,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<Allowance>> {
    const req = this.createRequest('GET');
    const mapped = req.prepareArgs({ id: [id, string()] });
    req.appendTemplatePath`/allowances/${mapped.id}`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(allowanceSchema, requestOptions);
  }

  /**
   * @param id
   * @param idempotencyKey  Same key and body return the same response; a different body
   *                                                    is 409
   * @param body
   * @return Response from the API call
   */
  async proposeAllowanceVersion(
    id: string,
    idempotencyKey: string,
    body: AllowanceProposal,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<AllowanceVersion>> {
    const req = this.createRequest('POST');
    const mapped = req.prepareArgs({
      id: [id, string()],
      idempotencyKey: [idempotencyKey, string()],
      body: [body, allowanceProposalSchema],
    });
    req.header('Idempotency-Key', mapped.idempotencyKey);
    req.header('Content-Type', 'application/json');
    req.json(mapped.body);
    req.appendTemplatePath`/allowances/${mapped.id}/versions`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(409, ProblemError, 'Idempotency or version conflict');
    req.throwOn(413, ProblemError, 'Body over 64 KiB');
    req.throwOn(422, ProblemError, 'Invalid request');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(allowanceVersionSchema, requestOptions);
  }

  /**
   * @param id
   * @param version
   * @return Response from the API call
   */
  async getAllowanceVersion(
    id: string,
    version: string,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<AllowanceVersion>> {
    const req = this.createRequest('GET');
    const mapped = req.prepareArgs({
      id: [id, string()],
      version: [version, string()],
    });
    req.appendTemplatePath`/allowances/${mapped.id}/versions/${mapped.version}`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(422, ProblemError, 'Invalid request');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(allowanceVersionSchema, requestOptions);
  }

  /**
   * @param id
   * @param version
   * @param idempotencyKey  Same key and body return the same response; a different body is 409
   * @param body
   * @return Response from the API call
   */
  async requestVersionMandate(
    id: string,
    version: string,
    idempotencyKey: string,
    body: unknown,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<Mandate>> {
    const req = this.createRequest('POST');
    const mapped = req.prepareArgs({
      id: [id, string()],
      version: [version, string()],
      idempotencyKey: [idempotencyKey, string()],
      body: [body, optional(unknown())],
    });
    req.header('Idempotency-Key', mapped.idempotencyKey);
    req.header('Content-Type', 'application/json');
    req.json(mapped.body);
    req.appendTemplatePath`/allowances/${mapped.id}/versions/${mapped.version}/mandate`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(409, ProblemError, 'Idempotency or version conflict');
    req.throwOn(413, ProblemError, 'Body over 64 KiB');
    req.throwOn(422, ProblemError, 'Invalid request');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(mandateSchema, requestOptions);
  }

  /**
   * @param id
   * @param idempotencyKey  Same key and body return the same response; a different body is 409
   * @param body
   * @return Response from the API call
   */
  async requestMandate(
    id: string,
    idempotencyKey: string,
    body: unknown,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<Mandate>> {
    const req = this.createRequest('POST');
    const mapped = req.prepareArgs({
      id: [id, string()],
      idempotencyKey: [idempotencyKey, string()],
      body: [body, optional(unknown())],
    });
    req.header('Idempotency-Key', mapped.idempotencyKey);
    req.header('Content-Type', 'application/json');
    req.json(mapped.body);
    req.appendTemplatePath`/allowances/${mapped.id}/mandate`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(409, ProblemError, 'Idempotency or version conflict');
    req.throwOn(413, ProblemError, 'Body over 64 KiB');
    req.throwOn(422, ProblemError, 'Invalid request');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(mandateSchema, requestOptions);
  }

  /**
   * @param id
   * @param key
   * @return Response from the API call
   */
  async getMandate(
    id: string,
    key: string,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<Mandate>> {
    const req = this.createRequest('GET');
    const mapped = req.prepareArgs({
      id: [id, string()],
      key: [key, string()],
    });
    req.appendTemplatePath`/allowances/${mapped.id}/mandate/${mapped.key}`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(mandateSchema, requestOptions);
  }

  /**
   * @param idempotencyKey  Same key and body return the same response; a different body is
   *                                                 409
   * @param body
   * @return Response from the API call
   */
  async requestBaseline(
    idempotencyKey: string,
    body: CodeTermsInput,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<Baseline>> {
    const req = this.createRequest('POST', '/baselines');
    const mapped = req.prepareArgs({
      idempotencyKey: [idempotencyKey, string()],
      body: [body, codeTermsInputSchema],
    });
    req.header('Idempotency-Key', mapped.idempotencyKey);
    req.header('Content-Type', 'application/json');
    req.json(mapped.body);
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(409, ProblemError, 'Idempotency or version conflict');
    req.throwOn(413, ProblemError, 'Body over 64 KiB');
    req.throwOn(422, ProblemError, 'Invalid request');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(baselineSchema, requestOptions);
  }

  /**
   * @param id
   * @return Response from the API call
   */
  async getBaseline(
    id: string,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<Baseline>> {
    const req = this.createRequest('GET');
    const mapped = req.prepareArgs({ id: [id, string()] });
    req.appendTemplatePath`/baselines/${mapped.id}`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(baselineSchema, requestOptions);
  }

  /**
   * @param id
   * @return Response from the API call
   */
  async getTranche(
    id: string,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<Tranche>> {
    const req = this.createRequest('GET');
    const mapped = req.prepareArgs({ id: [id, string()] });
    req.appendTemplatePath`/tranches/${mapped.id}`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(trancheSchema, requestOptions);
  }

  /**
   * @param id
   * @param idempotencyKey  Same key and body return the same response; a different body is
   *                                                 409
   * @param body
   * @return Response from the API call
   */
  async requestFunding(
    id: string,
    idempotencyKey: string,
    body: FundingRequest,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<Funding>> {
    const req = this.createRequest('POST');
    const mapped = req.prepareArgs({
      id: [id, string()],
      idempotencyKey: [idempotencyKey, string()],
      body: [body, fundingRequestSchema],
    });
    req.header('Idempotency-Key', mapped.idempotencyKey);
    req.header('Content-Type', 'application/json');
    req.json(mapped.body);
    req.appendTemplatePath`/tranches/${mapped.id}/funding`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(409, ProblemError, 'Idempotency or version conflict');
    req.throwOn(413, ProblemError, 'Body over 64 KiB');
    req.throwOn(422, ProblemError, 'Invalid request');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(fundingSchema, requestOptions);
  }

  /**
   * @param id
   * @param key
   * @return Response from the API call
   */
  async getFunding(
    id: string,
    key: string,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<Funding>> {
    const req = this.createRequest('GET');
    const mapped = req.prepareArgs({
      id: [id, string()],
      key: [key, string()],
    });
    req.appendTemplatePath`/tranches/${mapped.id}/funding/${mapped.key}`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(fundingSchema, requestOptions);
  }

  /**
   * @param id
   * @param idempotencyKey  Same key and body keep the same upload session and expiry; current
   *                                              URLs and status are derived on each read. A different body is 409.
   * @param body
   * @return Response from the API call
   */
  async createUpload(
    id: string,
    idempotencyKey: string,
    body: UploadInput,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<UploadSession>> {
    const req = this.createRequest('POST');
    const mapped = req.prepareArgs({
      id: [id, string()],
      idempotencyKey: [idempotencyKey, string()],
      body: [body, uploadInputSchema],
    });
    req.header('Idempotency-Key', mapped.idempotencyKey);
    req.header('Content-Type', 'application/json');
    req.json(mapped.body);
    req.appendTemplatePath`/tranches/${mapped.id}/uploads`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(409, ProblemError, 'Idempotency or version conflict');
    req.throwOn(413, ProblemError, 'Body over 64 KiB');
    req.throwOn(422, ProblemError, 'Invalid request');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(uploadSessionSchema, requestOptions);
  }

  /**
   * @param id
   * @param uploadId
   * @return Response from the API call
   */
  async getUpload(
    id: string,
    uploadId: string,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<UploadSession>> {
    const req = this.createRequest('GET');
    const mapped = req.prepareArgs({
      id: [id, string()],
      uploadId: [uploadId, string()],
    });
    req.appendTemplatePath`/tranches/${mapped.id}/uploads/${mapped.uploadId}`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(uploadSessionSchema, requestOptions);
  }

  /**
   * @param id
   * @param uploadId
   * @param idempotencyKey  Same key and body return the same response; a different body is 409
   * @param body
   * @return Response from the API call
   */
  async completeUpload(
    id: string,
    uploadId: string,
    idempotencyKey: string,
    body: unknown,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<UploadSession>> {
    const req = this.createRequest('POST');
    const mapped = req.prepareArgs({
      id: [id, string()],
      uploadId: [uploadId, string()],
      idempotencyKey: [idempotencyKey, string()],
      body: [body, optional(unknown())],
    });
    req.header('Idempotency-Key', mapped.idempotencyKey);
    req.header('Content-Type', 'application/json');
    req.json(mapped.body);
    req.appendTemplatePath`/tranches/${mapped.id}/uploads/${mapped.uploadId}/complete`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(409, ProblemError, 'Idempotency or version conflict');
    req.throwOn(413, ProblemError, 'Body over 64 KiB');
    req.throwOn(422, ProblemError, 'Invalid request');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(uploadSessionSchema, requestOptions);
  }

  /**
   * @param id
   * @param idempotencyKey  Same key and body return the same response; a different body
   *                                                     is 409
   * @param body
   * @return Response from the API call
   */
  async submitPackage(
    id: string,
    idempotencyKey: string,
    body: CommitPackageInput,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<CommitPackage>> {
    const req = this.createRequest('POST');
    const mapped = req.prepareArgs({
      id: [id, string()],
      idempotencyKey: [idempotencyKey, string()],
      body: [body, commitPackageInputSchema],
    });
    req.header('Idempotency-Key', mapped.idempotencyKey);
    req.header('Content-Type', 'application/json');
    req.json(mapped.body);
    req.appendTemplatePath`/tranches/${mapped.id}/packages`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(409, ProblemError, 'Idempotency or version conflict');
    req.throwOn(413, ProblemError, 'Body over 64 KiB');
    req.throwOn(422, ProblemError, 'Invalid request');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(commitPackageSchema, requestOptions);
  }

  /**
   * @param id
   * @param body
   * @return Response from the API call
   */
  async confirmUsage(
    id: string,
    body: UsageReceipt,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<UsageAcceptance>> {
    const req = this.createRequest('POST');
    const mapped = req.prepareArgs({
      id: [id, string()],
      body: [body, usageReceiptSchema],
    });
    req.header('Content-Type', 'application/json');
    req.json(mapped.body);
    req.appendTemplatePath`/tranches/${mapped.id}/usage`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(413, ProblemError, 'Body over 64 KiB');
    req.throwOn(422, ProblemError, 'Invalid request');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(usageAcceptanceSchema, requestOptions);
  }

  /**
   * @param id
   * @param packageId
   * @return Response from the API call
   */
  async getPackage(
    id: string,
    packageId: string,
    requestOptions?: RequestOptions
  ): Promise<ApiResponse<CommitPackage>> {
    const req = this.createRequest('GET');
    const mapped = req.prepareArgs({
      id: [id, string()],
      packageId: [packageId, string()],
    });
    req.appendTemplatePath`/tranches/${mapped.id}/packages/${mapped.packageId}`;
    req.throwOn(
      401,
      ProblemError,
      'Missing or invalid platform key or signature'
    );
    req.throwOn(404, ProblemError, 'Not found, or not owned by this platform');
    req.throwOn(
      429,
      ProblemError,
      "Too many requests: over the platform's per-minute budget (120 writes, 600 reads) or too many failed sign-ins from this address"
    );
    req.throwOn(
      503,
      ProblemError,
      'Storage or the feature is unavailable; retry with the same idempotency key'
    );
    req.authenticate([{ platformKey: true, requestSignature: true }]);
    return req.callAsJson(commitPackageSchema, requestOptions);
  }
}
