<template>
  <v-row class="mb-4">
    <v-col cols="12">
      <div class="event-tickets-title" :style="{ 'font-size': titleSize }">
        {{ title }}
      </div>
    </v-col>

    <v-col cols="12" md="12" sm="12">
      <TicketRow
        v-for="ticket in tickets"
        :key="ticket.id"
        :disable-menu="disableMenu"
        :name="ticket.name"
        :price="ticket.price"
        :status="ticket.status"
        :sold="ticket.sold"
        :total="ticket.total" />
    </v-col>
  </v-row>
</template>

<script>
export default {
  props: {
    tickets: { type: Array, required: true },
    title: { type: String, required: false, default: 'Ingressos Vendidos' },
    titleSize: { type: String, required: false, default: '40px' },
    disableMenu: { type: Boolean, required: false, default: false },
  },
};
</script>

<style scoped>
.event-tickets-title {
  font-weight: 700;
  text-align: left;
  color: var(--black-text);
  font-family: var(--font-family-poppins-bold);
}

@media (max-width: 360px) {
  .event-tickets-title {
    font-size: 16px !important;
  }
}

@media (min-width: 361px) and (max-width: 480px) {
  .event-tickets-title {
    font-size: 18px !important;
  }
}
</style>
