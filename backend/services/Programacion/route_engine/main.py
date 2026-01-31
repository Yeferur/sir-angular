from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
import math

app = FastAPI()

class Point(BaseModel):
    lat: float
    lng: float

class RouteRequest(BaseModel):
    points: List[Point]
    destination: Point

def haversine(a, b):
    R = 6371
    dlat = math.radians(b.lat - a.lat)
    dlng = math.radians(b.lng - a.lng)
    lat1 = math.radians(a.lat)
    lat2 = math.radians(b.lat)
    h = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlng/2)**2
    return 2 * R * math.asin(math.sqrt(h))

def vector(a, b):
    return (b.lng - a.lng, b.lat - a.lat)

def dot(a, b):
    return a[0]*b[0] + a[1]*b[1]

def norm(v):
    return math.sqrt(v[0]**2 + v[1]**2)

def progress(point, origin, direction):
    n = norm(direction)
    if n == 0:
        return 0
    v = vector(origin, point)
    return dot(v, direction) / n

@app.post("/optimize-route")
def optimize_route(req: RouteRequest):
    if len(req.points) < 1:
        raise HTTPException(status_code=400, detail="No points")

    unique = {}
    for p in req.points:
        key = f"{round(p.lat,6)}|{round(p.lng,6)}"
        unique[key] = p

    points = list(unique.values())

    if len(points) == 1:
        return {
            "ordered_points": points,
            "destination": req.destination
        }

    center = Point(
        lat=sum(p.lat for p in points) / len(points),
        lng=sum(p.lng for p in points) / len(points)
    )

    direction = vector(center, req.destination)

    enriched = []
    for p in points:
        enriched.append({
            "point": p,
            "progress": progress(p, center, direction),
            "dist": haversine(p, req.destination)
        })

    enriched.sort(key=lambda x: (x["progress"], -x["dist"]))

    ordered = [e["point"] for e in enriched]

    return {
        "ordered_points": ordered,
        "destination": req.destination
    }
