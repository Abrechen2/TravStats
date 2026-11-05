import { api } from "./client";

interface Envelope<T> {
  success: boolean;
  data: T;
}

/** A category the user made for their own places. A place carries it by `name`. */
export interface CustomPlaceCategory {
  id: string;
  name: string;
  icon: string | null;
}

export async function listPlaceCategories(): Promise<CustomPlaceCategory[]> {
  const res = await api.get<Envelope<CustomPlaceCategory[]>>("/place-categories");
  return res.data.data;
}

export async function createPlaceCategory(input: {
  name: string;
  icon?: string | null;
}): Promise<CustomPlaceCategory> {
  const res = await api.post<Envelope<CustomPlaceCategory>>("/place-categories", input);
  return res.data.data;
}

export async function deletePlaceCategory(id: string): Promise<{ movedPlaces: number }> {
  const res = await api.delete<Envelope<{ movedPlaces: number }>>(`/place-categories/${id}`);
  return res.data.data;
}
