// the two API examples for the "Advanced (API)" box: bash and PowerShell
export function addCalls(origin, ticket) {
  const bash = `curl -X POST ${origin}/api/v1/bots/gallery/add \\\n  -H "Authorization: Bearer <your session on that instance>" -H "Content-Type: application/json" \\\n  -d '{"ticket":"${ticket}","sid":"<server id on that instance>"}'`;
  const ps = `$h = @{ Authorization = "Bearer <your session on that instance>" }\n$body = @{ ticket = "${ticket}"; sid = "<server id on that instance>" } | ConvertTo-Json\nInvoke-RestMethod -Method Post -Uri "${origin}/api/v1/bots/gallery/add" -Headers $h -ContentType "application/json" -Body $body`;
  return { bash, ps };
}
