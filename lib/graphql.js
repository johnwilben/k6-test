import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "https://jewelry-uat.palawanpay.com";
const GRAPHQL_URL = `${BASE_URL}/graphql`;

export function gqlRequest(query, variables = {}, token = null) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const payload = JSON.stringify({ query, variables });

  const res = http.post(GRAPHQL_URL, payload, { headers });

  check(res, {
    "GraphQL status 200": (r) => r.status === 200,
    "no GraphQL errors": (r) => {
      try {
        const body = JSON.parse(r.body);
        return !body.errors;
      } catch {
        return false;
      }
    },
  });

  return res;
}

export function parseGQL(res) {
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}
