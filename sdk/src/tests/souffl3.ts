import { SouffleChefCampaign, CandyMachine } from './types/aptos/account-4188c8'

SouffleChefCampaign.bind()
  .onEntryPullTokenV2((call, ctx) => {
    ctx.meter.Counter('call_num').add(1)
    ctx.meter.Counter('pulled').add(parseInt(call.arguments[4]))
  })
  .onEventBurnEnjoyEvent((evt, ctx) => {
    ctx.meter.Counter('burned').add(1)
  })
  .onEvent(
    (event, ctx) => {
      ctx.meter.Counter('evt_num').add(1)
    },
    {
      type: '0x1::coin::DepositEvent',
    }
  )
  .onTransaction((txn, ctx) => {
    if (txn.events) {
      for (const event of txn.events) {
        if (event && event.type === '0x3::token::DepositEvent') {
          ctx.meter.Counter('deposit_token_count').add(Number(event.data.amount))
        }
      }
    }
  })

CandyMachine.bind().onEntryPullToken((call, ctx) => {
  ctx.meter.Counter('pulled').add(parseInt(call.arguments[3]))
})
