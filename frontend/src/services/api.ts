import axios from 'axios';
import type { IRGraph } from '../types/ir';

const api = axios.create({
  baseURL: 'http://localhost:8000/api',
});

export async function loadModel(file: File): Promise<IRGraph> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post<IRGraph>('/model/load', formData);
  return response.data;
}

export async function saveModel(): Promise<string> {
  const response = await api.post('/model/save', null, {
    responseType: 'text',
  });
  return response.data;
}
