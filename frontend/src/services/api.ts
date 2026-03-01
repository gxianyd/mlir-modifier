import axios from 'axios';
import type { IRGraph, EditResponse, HistoryStatus, SaveResponse } from '../types/ir';

const api = axios.create({
  baseURL: 'http://localhost:8000/api',
});

export async function loadModel(file: File): Promise<IRGraph> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post<IRGraph>('/model/load', formData);
  return response.data;
}

export async function saveModel(): Promise<SaveResponse> {
  const response = await api.post<SaveResponse>('/model/save');
  return response.data;
}

export async function modifyAttributes(
  opId: string,
  updates: Record<string, string>,
  deletes: string[],
): Promise<EditResponse> {
  const response = await api.patch<EditResponse>(`/op/${opId}/attributes`, {
    updates,
    deletes,
  });
  return response.data;
}

export async function deleteOp(opId: string): Promise<EditResponse> {
  const response = await api.delete<EditResponse>(`/op/${opId}`);
  return response.data;
}

export async function deleteOpSingle(opId: string): Promise<EditResponse> {
  const response = await api.delete<EditResponse>(`/op/${opId}`, {
    params: { cascade: false },
  });
  return response.data;
}

export async function undo(): Promise<EditResponse> {
  const response = await api.post<EditResponse>('/undo');
  return response.data;
}

export async function redo(): Promise<EditResponse> {
  const response = await api.post<EditResponse>('/redo');
  return response.data;
}

export async function getHistoryStatus(): Promise<HistoryStatus> {
  const response = await api.get<HistoryStatus>('/history');
  return response.data;
}

export interface OpDefinitionInfo {
  name: string;
  dialect: string;
  description: string;
}

export interface CreateOpRequest {
  op_name: string;
  result_types: string[];
  operands: string[];
  attributes: Record<string, string>;
  insert_point: { block_id: string; position: number | null };
}

export interface OpParamInfo {
  name: string;
  kind: 'operand' | 'attribute';
  required: boolean;
}

export interface OpSignature {
  op_name: string;
  params: OpParamInfo[];
  num_results: number; // -1 = variadic
  num_regions: number;
}

export async function getOpSignature(opName: string): Promise<OpSignature> {
  const response = await api.get<OpSignature>(`/op/${opName}/signature`);
  return response.data;
}

export async function listDialects(): Promise<string[]> {
  const response = await api.get<string[]>('/dialects');
  return response.data;
}

export async function listDialectOps(dialectName: string): Promise<OpDefinitionInfo[]> {
  const response = await api.get<OpDefinitionInfo[]>(`/dialect/${dialectName}/ops`);
  return response.data;
}

export async function createOp(request: CreateOpRequest): Promise<EditResponse> {
  const response = await api.post<EditResponse>('/op/create', request);
  return response.data;
}

export async function setOperand(
  opId: string,
  operandIndex: number,
  newValueId: string,
): Promise<EditResponse> {
  const response = await api.put<EditResponse>(`/op/${opId}/operand/${operandIndex}`, {
    new_value_id: newValueId,
  });
  return response.data;
}

export async function removeOperand(
  opId: string,
  operandIndex: number,
): Promise<EditResponse> {
  const response = await api.delete<EditResponse>(`/op/${opId}/operand/${operandIndex}`);
  return response.data;
}

export async function addToOutput(
  opId: string,
  resultIndex: number = 0,
): Promise<EditResponse> {
  const response = await api.post<EditResponse>(`/op/${opId}/add-to-output`, {
    result_index: resultIndex,
  });
  return response.data;
}

export async function addOperand(
  opId: string,
  valueId: string,
  position?: number,
): Promise<EditResponse> {
  const response = await api.post<EditResponse>(`/op/${opId}/operand`, {
    value_id: valueId,
    position: position ?? null,
  });
  return response.data;
}
